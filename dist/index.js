import { emitFile } from "@typespec/compiler";
import { collectServices, extractFields, scalarName, isArrayType, isRecordType, arrayElementType, recordElementType, toSnakeCase, dottedPathToSnakeCase, checkAndReportReservedKeywords, safeFieldName, } from "@specodec/typespec-emitter-core";
function fieldRb(name) {
    return safeFieldName("ruby", toSnakeCase(name));
}
function rbDefault(type) {
    const n = scalarName(type);
    if (n === "boolean")
        return "false";
    if (["int8", "int16", "int32", "int64", "uint8", "uint16", "uint32", "uint64", "integer"].includes(n))
        return "0";
    if (["float32", "float64", "float", "decimal"].includes(n))
        return "0.0";
    return "nil";
}
function writeLines(type, varExpr, indent) {
    const n = scalarName(type);
    if (n === "string")
        return [`${indent}w.write_string(${varExpr})`];
    if (n === "bytes")
        return [`${indent}w.write_bytes(${varExpr})`];
    if (n === "boolean")
        return [`${indent}w.write_bool(${varExpr})`];
    if (["int8", "int16", "int32", "integer"].includes(n))
        return [`${indent}w.write_int32(${varExpr})`];
    if (n === "int64")
        return [`${indent}w.write_int64(${varExpr})`];
    if (["uint8", "uint16", "uint32"].includes(n))
        return [`${indent}w.write_uint32(${varExpr})`];
    if (n === "uint64")
        return [`${indent}w.write_uint64(${varExpr})`];
    if (n === "float32")
        return [`${indent}w.write_float32(${varExpr})`];
    if (["float64", "float", "decimal"].includes(n))
        return [`${indent}w.write_float64(${varExpr})`];
    if (isArrayType(type)) {
        const elem = arrayElementType(type);
        return [
            `${indent}w.begin_array(${varExpr}.length)`,
            `${indent}${varExpr}.each do |item|`,
            `${indent}  w.next_element`,
            ...writeLines(elem, "item", `${indent}  `),
            `${indent}end`,
            `${indent}w.end_array`,
        ];
    }
    if (isRecordType(type)) {
        const elem = recordElementType(type);
        return [
            `${indent}w.begin_object(${varExpr}.size)`,
            `${indent}${varExpr}.each do |key, val|`,
            `${indent}  w.write_field(key)`,
            ...writeLines(elem, "val", `${indent}  `),
            `${indent}end`,
            `${indent}w.end_object`,
        ];
    }
    if (type.kind === "Enum")
        return [`${indent}w.write_string(${varExpr})`];
    if (type.kind === "Model" && type.name) {
        const name = type.name;
        return [`${indent}${name}Methods.write_${toSnakeCase(name)}(w, ${varExpr})`];
    }
    if (type.kind === "Union") {
        const name = type.name;
        return [`${indent}${name}Methods.write_${toSnakeCase(name)}(w, ${varExpr})`];
    }
    return [`${indent}w.write_string(${varExpr}.to_s)`];
}
function readExpr(type, optional) {
    const n = scalarName(type);
    if (n === "string")
        return "r.read_string";
    if (n === "bytes")
        return "r.read_bytes";
    if (n === "boolean")
        return "r.read_bool";
    if (["int8", "int16", "int32", "integer"].includes(n))
        return "r.read_int32";
    if (n === "int64")
        return "r.read_int64";
    if (["uint8", "uint16", "uint32"].includes(n))
        return "r.read_uint32";
    if (n === "uint64")
        return "r.read_uint64";
    if (n === "float32")
        return "r.read_float32";
    if (["float64", "float", "decimal"].includes(n))
        return "r.read_float64";
    if (isArrayType(type)) {
        const elem = arrayElementType(type);
        const readE = readExpr(elem);
        const expr = `->(r) { arr = []; r.begin_array; arr << ${readE} while r.has_next_element; r.end_array; arr }.call(r)`;
        if (optional)
            return `r.is_null ? r.read_null : ${expr}`;
        return expr;
    }
    if (isRecordType(type)) {
        const elem = recordElementType(type);
        const readE = readExpr(elem);
        const expr = `->(r) { map = {}; r.begin_object; map[r.read_field_name] = ${readE} while r.has_next_field; r.end_object; map }.call(r)`;
        if (optional)
            return `r.is_null ? r.read_null : ${expr}`;
        return expr;
    }
    if (type.kind === "Enum")
        return "r.read_string";
    if (type.kind === "Model" && type.name) {
        const name = type.name;
        const sn = toSnakeCase(name);
        if (optional)
            return `r.is_null ? r.read_null : ${name}Methods.decode_${sn}(r)`;
        return `${name}Methods.decode_${sn}(r)`;
    }
    if (type.kind === "Union") {
        const name = type.name;
        const sn = toSnakeCase(name);
        if (optional)
            return `r.is_null ? r.read_null : ${name}Methods.decode_${sn}(r)`;
        return `${name}Methods.decode_${sn}(r)`;
    }
    return "r.read_string";
}
function emitModelClass(m, L) {
    if (!m.name)
        return;
    const fields = extractFields(m);
    const required = fields.filter((f) => !f.optional);
    const optional = fields.filter((f) => f.optional);
    const sn = toSnakeCase(m.name);
    L.push(`class ${m.name}`);
    if (fields.length > 0) {
        L.push(`  attr_accessor ${fields.map((f) => `:${fieldRb(f.name)}`).join(", ")}`);
        L.push("");
        L.push(`  def initialize(`);
        const params = [];
        for (const f of required)
            params.push(`    ${fieldRb(f.name)}: ${rbDefault(f.type)}`);
        for (const f of optional)
            params.push(`    ${fieldRb(f.name)}: nil`);
        L.push(params.join(",\n"));
        L.push(`  )`);
        for (const f of fields)
            L.push(`    @${fieldRb(f.name)} = ${fieldRb(f.name)}`);
        L.push(`  end`);
    }
    L.push(`end`);
    L.push("");
    // Module with encode/decode class methods
    L.push(`module ${m.name}Methods`);
    L.push(`  def self.write_${sn}(w, obj)`);
    if (optional.length === 0) {
        L.push(`    w.begin_object(${fields.length})`);
    }
    else {
        L.push(`    count = ${required.length}`);
        for (const f of optional)
            L.push(`    count += 1 unless obj.${fieldRb(f.name)}.nil?`);
        L.push(`    w.begin_object(count)`);
    }
    for (const f of fields) {
        const fRb = fieldRb(f.name);
        if (f.optional) {
            L.push(`    unless obj.${fRb}.nil?`);
            L.push(`      w.write_field("${f.name}")`);
            for (const line of writeLines(f.type, `obj.${fRb}`, "      "))
                L.push(line);
            L.push(`    end`);
        }
        else {
            L.push(`    w.write_field("${f.name}")`);
            for (const line of writeLines(f.type, `obj.${fRb}`, "    "))
                L.push(line);
        }
    }
    L.push(`    w.end_object`);
    L.push(`  end`);
    L.push("");
    L.push(`  def self.decode_${sn}(r)`);
    L.push(`    r.begin_object`);
    L.push(`    obj = ${m.name}.new`);
    L.push(`    while r.has_next_field`);
    L.push(`      key = r.read_field_name`);
    for (const f of fields) {
        L.push(`      if key == "${f.name}" then obj.${fieldRb(f.name)} = ${readExpr(f.type, f.optional)}; next; end`);
    }
    L.push(`      r.skip`);
    L.push(`    end`);
    L.push(`    r.end_object`);
    L.push(`    obj`);
    L.push(`  end`);
    L.push(`end`);
    L.push("");
}
function generateEnumCode(e) {
    const lines = [];
    lines.push(`module ${e.name}`);
    for (const m of e.members) {
        lines.push(`  ${m.name} = ${m.value}`);
    }
    lines.push(`end`);
    return lines;
}
function generateUnionCode(u, L) {
    const snakeName = toSnakeCase(u.name);
    const undefCls = `${u.name}Undefined`;
    for (const v of u.variants) {
        const pascal = v.name.charAt(0).toUpperCase() + v.name.slice(1);
        const wrapper = `${u.name}${pascal}`;
        L.push(`class ${wrapper}`);
        L.push(`  attr_accessor :value`);
        L.push(`  def initialize(value) = (@value = value)`);
        L.push(`end`);
        L.push("");
    }
    L.push(`class ${undefCls}`);
    L.push(`  attr_accessor :value`);
    L.push(`  def initialize(value = Specodec::SpecUndefined.new) = (@value = value)`);
    L.push(`end`);
    L.push("");
    L.push(`module ${u.name}Methods`);
    L.push(`  def self.write_${snakeName}(w, obj)`);
    L.push(`    w.begin_object(1)`);
    for (let i = 0; i < u.variants.length; i++) {
        const v = u.variants[i];
        const pascal = v.name.charAt(0).toUpperCase() + v.name.slice(1);
        const wrapper = `${u.name}${pascal}`;
        const stmts = writeLines(v.type, "obj.value", "      ").join("; ");
        const kw = i === 0 ? "if" : "elsif";
        L.push(`    ${kw} obj.is_a?(${wrapper}); w.write_field("${v.name}"); ${stmts}`);
    }
    L.push(`    else raise "cannot encode Undefined" end`);
    L.push(`    w.end_object`);
    L.push(`  end`);
    L.push("");
    L.push(`  def self.decode_${snakeName}(r)`);
    L.push(`    r.begin_object`);
    L.push(`    result = ${undefCls}.new`);
    L.push(`    if r.has_next_field`);
    L.push(`      field = r.read_field_name`);
    for (let i = 0; i < u.variants.length; i++) {
        const v = u.variants[i];
        const pascal = v.name.charAt(0).toUpperCase() + v.name.slice(1);
        const wrapper = `${u.name}${pascal}`;
        const kw = i === 0 ? "if" : "elsif";
        L.push(`      ${kw} field == "${v.name}"; result = ${wrapper}.new(${readExpr(v.type)})`);
    }
    L.push(`      end`);
    L.push(`    end`);
    L.push(`    while r.has_next_field; r.read_field_name; r.skip; end`);
    L.push(`    r.end_object`);
    L.push(`    result`);
    L.push(`  end`);
    L.push(`end`);
    L.push("");
}
export async function $onEmit(context) {
    const program = context.program;
    const outputDir = context.emitterOutputDir;
    const ignoreReservedKeywords = context.options["ignore-reserved-keywords"] ?? false;
    const services = collectServices(program);
    if (checkAndReportReservedKeywords(program, services, ignoreReservedKeywords))
        return;
    const rbModelNs = new Map();
    for (const s of services) {
        for (const m of s.models) {
            if (m.name)
                rbModelNs.set(m.name, s.serviceName);
        }
        for (const e of s.enums) {
            if (e.name)
                rbModelNs.set(e.name, s.serviceName);
        }
        for (const u of s.unions) {
            if (u.name)
                rbModelNs.set(u.name, s.serviceName);
        }
    }
    for (const svc of services) {
        const L = [];
        L.push("# frozen_string_literal: true");
        L.push("");
        L.push("# Generated by @specodec/typespec-emitter-ruby. DO NOT EDIT.");
        L.push("");
        L.push("require 'specodec'");
        const xrefNs = new Set();
        for (const m of svc.models) {
            if (!m.name)
                continue;
            for (const f of extractFields(m)) {
                const collectX = (t) => {
                    if ((t.kind === "Model" || t.kind === "Enum") && t.name) {
                        const ns = rbModelNs.get(t.name);
                        if (ns && ns !== svc.serviceName)
                            xrefNs.add(ns);
                    }
                    if (isArrayType(t))
                        collectX(arrayElementType(t));
                    if (isRecordType(t))
                        collectX(recordElementType(t));
                };
                collectX(f.type);
            }
        }
        for (const u of svc.unions) {
            for (const v of u.variants) {
                const collectX = (t) => {
                    if ((t.kind === "Model" || t.kind === "Enum") && t.name) {
                        const ns = rbModelNs.get(t.name);
                        if (ns && ns !== svc.serviceName)
                            xrefNs.add(ns);
                    }
                    if (isArrayType(t))
                        collectX(arrayElementType(t));
                    if (isRecordType(t))
                        collectX(recordElementType(t));
                };
                collectX(v.type);
            }
        }
        for (const ns of [...xrefNs].sort()) {
            L.push(`require_relative '${dottedPathToSnakeCase(ns)}_types'`);
        }
        L.push("");
        for (const m of svc.models)
            emitModelClass(m, L);
        for (const e of svc.enums) {
            L.push(...generateEnumCode(e));
            L.push("");
        }
        for (const u of svc.unions)
            generateUnionCode(u, L);
        // Codec registrations
        for (const m of svc.models) {
            if (!m.name)
                continue;
            const sn = toSnakeCase(m.name);
            L.push(`${m.name}Codec = Specodec::SpecCodec.new(`);
            L.push(`  encode: ${m.name}Methods.method(:write_${sn}),`);
            L.push(`  decode: ${m.name}Methods.method(:decode_${sn}),`);
            L.push(`)`);
            L.push("");
        }
        for (const u of svc.unions) {
            if (!u.name)
                continue;
            const sn = toSnakeCase(u.name);
            L.push(`${u.name}Codec = Specodec::SpecCodec.new(`);
            L.push(`  encode: ${u.name}Methods.method(:write_${sn}),`);
            L.push(`  decode: ${u.name}Methods.method(:decode_${sn}),`);
            L.push(`)`);
            L.push("");
        }
        const fileName = `${dottedPathToSnakeCase(svc.serviceName)}_types.rb`;
        await emitFile(program, { path: `${outputDir}/${fileName}`, content: L.join("\n") });
    }
    let barrelContent = "# frozen_string_literal: true\n\n# Generated by @specodec/typespec-emitter-ruby. DO NOT EDIT.\n\n";
    barrelContent += "require 'specodec'\n\n";
    for (const svc of services) {
        barrelContent += `require_relative '${dottedPathToSnakeCase(svc.serviceName)}_types'\n`;
    }
    await emitFile(program, { path: `${outputDir}/all_types.rb`, content: barrelContent });
}
