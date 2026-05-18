import { type EmitContext, emitFile, type Enum, type Model, type Type, type Union } from "@typespec/compiler";
import {
  collectServices,
  type BaseEmitterOptions,
  type EnumInfo,
  type EnumMemberInfo,
  type UnionInfo,
  type UnionVariantInfo,
  extractFields,
  scalarName,
  isArrayType,
  isRecordType,
  isUnionType,
  isScalarVariant,
  arrayElementType,
  recordElementType,
  toSnakeCase,
  dottedPathToSnakeCase,
  checkAndReportReservedKeywords,
  safeFieldName,
} from "@specodec/typespec-emitter-core";

export type EmitterOptions = BaseEmitterOptions;

let _tmpCounter = 0;
function nextTmp(): string {
  return `tmp`;
}

function fieldRb(name: string): string {
  return safeFieldName("ruby", toSnakeCase(name));
}

// ── RBS type helpers ──────────────────────────────────────────────────────────

function rbsType(type: Type, optional?: boolean): string {
  const base = rbsTypeBase(type);
  return optional ? `${base}?` : base;
}

function rbsTypeBase(type: Type): string {
  const n = scalarName(type);
  if (n) {
    switch (n) {
      case "string": return "String";
      case "boolean": return "bool";
      case "int8": case "int16": case "int32": case "int64":
      case "uint8": case "uint16": case "uint32": case "uint64":
      case "integer": return "Integer";
      case "float32": case "float64": case "float": case "decimal": return "Float";
      case "bytes": return "String";
    }
  }
  if (isArrayType(type)) {
    return `Array[${rbsType(arrayElementType(type)!)}]`;
  }
  if (isRecordType(type)) {
    return `Hash[String, ${rbsType(recordElementType(type)!)}]`;
  }
  if (type.kind === "Enum") return "String";
  if (type.kind === "Model" && (type as Model).name) return (type as Model).name!;
  if (type.kind === "Union" && (type as Union).name) return (type as Union).name!;
  return "untyped";
}

function rbsInitParam(f: { name: string; type: Type; optional?: boolean }): string {
  const ft = rbsType(f.type, f.optional);
  const sn = fieldRb(f.name);
  return f.optional ? `?${sn}: ${ft}` : `${sn}: ${ft}`;
}

// ── RBS emit functions ───────────────────────────────────────────────────────

function emitModelRbs(m: Model, L: string[]): void {
  if (!m.name) return;
  const fields = extractFields(m);
  const sn = toSnakeCase(m.name);

  L.push(`class ${m.name}`);
  for (const f of fields) {
    L.push(`  attr_accessor ${fieldRb(f.name)}: ${rbsType(f.type, f.optional)}`);
  }
  L.push("");
  if (fields.length > 0) {
    L.push(`  def initialize: (${fields.map(rbsInitParam).join(", ")}) -> void`);
  }
  L.push(`end`);
  L.push("");

  L.push(`module ${m.name}Methods`);
  L.push(`  def self.write_${sn}: (Specodec::SpecWriter, ${m.name}) -> void`);
  L.push(`  def self.decode_${sn}: (Specodec::SpecReader) -> ${m.name}`);
  L.push(`end`);
  L.push("");

  L.push(`${m.name}Codec: Specodec::SpecCodec[${m.name}]`);
  L.push("");
}

function emitEnumRbs(e: EnumInfo, L: string[]): void {
  const members = e.members.map((em) => `${em.name}: ${em.value}`).join("\n  ");
  L.push(`module ${e.name}`);
  L.push(`  ${members}`);
  L.push(`end`);
  L.push("");
}

function emitUnionRbs(u: UnionInfo, L: string[]): void {
  const snakeName = toSnakeCase(u.name);
  const undefCls = `${u.name}Undefined`;
  const variantTypes: string[] = [];

  for (const v of u.variants) {
    const pascal = v.name.charAt(0).toUpperCase() + v.name.slice(1);
    const wrapper = `${u.name}${pascal}`;
    const vt = rbsType(v.type);
    variantTypes.push(wrapper);
    L.push(`class ${wrapper}`);
    L.push(`  attr_accessor value: ${vt}`);
    L.push(`  def initialize: (${vt} value) -> void`);
    L.push(`end`);
    L.push("");
  }

  variantTypes.push(undefCls);
  L.push(`class ${undefCls}`);
  L.push(`  attr_accessor value: Specodec::SpecUndefined`);
  L.push(`  def initialize: (?Specodec::SpecUndefined value) -> void`);
  L.push(`end`);
  L.push("");

  const variantUnion = variantTypes.join(" | ");
  L.push(`module ${u.name}Methods`);
  L.push(`  def self.write_${snakeName}: (Specodec::SpecWriter, ${variantUnion}) -> void`);
  L.push(`  def self.decode_${snakeName}: (Specodec::SpecReader) -> (${variantUnion})`);
  L.push(`end`);
  L.push("");

  L.push(`${u.name}Codec: Specodec::SpecCodec[${variantUnion}]`);
  L.push("");
}

function rbDefault(type: Type): string {
  const n = scalarName(type);
  if (n === "boolean") return "false";
  if (["int8", "int16", "int32", "int64", "uint8", "uint16", "uint32", "uint64", "integer"].includes(n)) return "0";
  if (["float32", "float64", "float", "decimal"].includes(n)) return "0.0";
  return "nil";
}

function writeLines(type: Type, varExpr: string, indent: string): string[] {
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
    const elem = arrayElementType(type)!;
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
    const elem = recordElementType(type)!;
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
  if (type.kind === "Model" && (type as Model).name) {
    const name = (type as Model).name;
    return [`${indent}${name}Methods.write_${toSnakeCase(name)}(w, ${varExpr})`];
  }
  if (type.kind === "Union") {
    const name = (type as Union).name!;
    return [`${indent}${name}Methods.write_${toSnakeCase(name)}(w, ${varExpr})`];
  }
  return [`${indent}w.write_string(${varExpr}.to_s)`];
}

function readExpr(type: Type): string {
  const n = scalarName(type);
  if (n === "string") return "r.read_string";
  if (n === "bytes") return "r.read_bytes";
  if (n === "boolean") return "r.read_bool";
  if (["int8", "int16", "int32", "integer"].includes(n)) return "r.read_int32";
  if (n === "int64") return "r.read_int64";
  if (["uint8", "uint16", "uint32"].includes(n)) return "r.read_uint32";
  if (n === "uint64") return "r.read_uint64";
  if (n === "float32") return "r.read_float32";
  if (["float64", "float", "decimal"].includes(n)) return "r.read_float64";
  if (type.kind === "Enum") return "r.read_string";
  if (type.kind === "Model" && (type as Model).name) {
    const name = (type as Model).name;
    const sn = toSnakeCase(name);
    return `${name}Methods.decode_${sn}(r)`;
  }
  if (type.kind === "Union") {
    const name = (type as Union).name!;
    const sn = toSnakeCase(name);
    return `${name}Methods.decode_${sn}(r)`;
  }
  return "r.read_string";
}

function generateFieldRead(f: { name: string; type: any; optional: boolean }): { stmts: string[]; value: string } {
  if (isArrayType(f.type)) {
    const elem = arrayElementType(f.type)!;
    const tmp = nextTmp();
    const stmts: string[] = [];
    if (f.optional) {
      stmts.push(`${tmp} = nil`);
      stmts.push(`if r.is_null`);
      stmts.push(`    r.read_null`);
      stmts.push(`else`);
      stmts.push(`    ${tmp} = []`);
      stmts.push(`    r.begin_array`);
      stmts.push(`    ${tmp} << ${readExpr(elem)} while r.has_next_element`);
      stmts.push(`    r.end_array`);
      stmts.push(`end`);
      return { stmts, value: tmp };
    } else {
      stmts.push(`${tmp} = []`);
      stmts.push(`r.begin_array`);
      stmts.push(`${tmp} << ${readExpr(elem)} while r.has_next_element`);
      stmts.push(`r.end_array`);
      return { stmts, value: tmp };
    }
  }
  if (isRecordType(f.type)) {
    const elem = recordElementType(f.type)!;
    const tmp = nextTmp();
    const stmts: string[] = [];
    if (f.optional) {
      stmts.push(`${tmp} = nil`);
      stmts.push(`if r.is_null`);
      stmts.push(`    r.read_null`);
      stmts.push(`else`);
      stmts.push(`    ${tmp} = {}`);
      stmts.push(`    r.begin_object`);
      stmts.push(`    ${tmp}[r.read_field_name] = ${readExpr(elem)} while r.has_next_field`);
      stmts.push(`    r.end_object`);
      stmts.push(`end`);
      return { stmts, value: tmp };
    } else {
      stmts.push(`${tmp} = {}`);
      stmts.push(`r.begin_object`);
      stmts.push(`${tmp}[r.read_field_name] = ${readExpr(elem)} while r.has_next_field`);
      stmts.push(`r.end_object`);
      return { stmts, value: tmp };
    }
  }
  if (f.optional && ((f.type.kind === "Model" && (f.type as Model).name) || (f.type.kind === "Union" && (f.type as Union).name))) {
    const tmp = nextTmp();
    const stmts: string[] = [];
    stmts.push(`${tmp} = nil`);
    stmts.push(`if r.is_null`);
    stmts.push(`    r.read_null`);
    stmts.push(`else`);
    stmts.push(`    ${tmp} = ${readExpr(f.type)}`);
    stmts.push(`end`);
    return { stmts, value: tmp };
  }
  return { stmts: [], value: readExpr(f.type) };
}

function emitModelClass(m: Model, L: string[]): void {
  if (!m.name) return;
  const fields = extractFields(m);
  const required = fields.filter((f) => !f.optional);
  const optional = fields.filter((f) => f.optional);
  const sn = toSnakeCase(m.name);

  L.push(`class ${m.name}`);
  if (fields.length > 0) {
    L.push(`  attr_accessor ${fields.map((f) => `:${fieldRb(f.name)}`).join(", ")}`);
    L.push("");
    L.push(`  def initialize(`);
    const params: string[] = [];
    for (const f of required) params.push(`    ${fieldRb(f.name)}: ${rbDefault(f.type)}`);
    for (const f of optional) params.push(`    ${fieldRb(f.name)}: nil`);
    L.push(params.join(",\n"));
    L.push(`  )`);
    for (const f of fields) L.push(`    @${fieldRb(f.name)} = ${fieldRb(f.name)}`);
    L.push(`  end`);
  }
  L.push(`end`);
  L.push("");

  // Module with encode/decode class methods
  L.push(`module ${m.name}Methods`);
  L.push(`  def self.write_${sn}(w, obj)`);
  if (optional.length === 0) {
    L.push(`    w.begin_object(${fields.length})`);
  } else {
    L.push(`    count = ${required.length}`);
    for (const f of optional) L.push(`    count += 1 unless obj.${fieldRb(f.name)}.nil?`);
    L.push(`    w.begin_object(count)`);
  }
  for (const f of fields) {
    const fRb = fieldRb(f.name);
    if (f.optional) {
      L.push(`    unless obj.${fRb}.nil?`);
      L.push(`      w.write_field("${f.name}")`);
      for (const line of writeLines(f.type, `obj.${fRb}`, "      ")) L.push(line);
      L.push(`    end`);
    } else {
      L.push(`    w.write_field("${f.name}")`);
      for (const line of writeLines(f.type, `obj.${fRb}`, "    ")) L.push(line);
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
  const decodeResults: { name: string; fRb: string; result: { stmts: string[]; value: string } }[] = [];
  for (const f of fields) {
    decodeResults.push({ name: f.name, fRb: fieldRb(f.name), result: generateFieldRead(f) });
  }
  for (const { name, fRb, result } of decodeResults) {
    if (result.stmts.length > 0) {
      L.push(`      if key == "${name}"`);
      for (const stmt of result.stmts) {
        L.push(`        ${stmt}`);
      }
      L.push(`        obj.${fRb} = ${result.value}`);
      L.push(`        next`);
      L.push(`      end`);
    } else {
      L.push(`      if key == "${name}" then obj.${fRb} = ${result.value}; next; end`);
    }
  }
  L.push(`      r.skip`);
  L.push(`    end`);
  L.push(`    r.end_object`);
  L.push(`    obj`);
  L.push(`  end`);
  L.push(`end`);
  L.push("");
}

function generateEnumCode(e: EnumInfo): string[] {
  const lines: string[] = [];
  lines.push(`module ${e.name}`);
  for (const m of e.members) {
    lines.push(`  ${m.name} = ${m.value}`);
  }
  lines.push(`end`);
  return lines;
}

function generateUnionCode(u: UnionInfo, L: string[]): void {
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

export async function $onEmit(context: EmitContext<EmitterOptions>) {
  const program = context.program;
  const outputDir = context.emitterOutputDir;
  const ignoreReservedKeywords = context.options["ignore-reserved-keywords"] ?? false;
  const services = collectServices(program);

  if (checkAndReportReservedKeywords(program, services, ignoreReservedKeywords)) return;

  const rbModelNs = new Map<string, string>();
  for (const s of services) {
    for (const m of s.models) { if (m.name) rbModelNs.set(m.name, s.serviceName); }
    for (const e of s.enums) { if (e.name) rbModelNs.set(e.name, s.serviceName); }
    for (const u of s.unions) { if (u.name) rbModelNs.set(u.name, s.serviceName); }
  }

  for (const svc of services) {
    const L: string[] = [];
    L.push("# frozen_string_literal: true");
    L.push("");
    L.push("# Generated by @specodec/typespec-emitter-ruby. DO NOT EDIT.");
    L.push("");
    L.push("require 'specodec'");

    const xrefNs = new Set<string>();
    for (const m of svc.models) {
      if (!m.name) continue;
      for (const f of extractFields(m)) {
        const collectX = (t: Type) => {
          if ((t.kind === "Model" || t.kind === "Enum") && (t as any).name) {
            const ns = rbModelNs.get((t as any).name);
            if (ns && ns !== svc.serviceName) xrefNs.add(ns);
          }
          if (isArrayType(t)) collectX(arrayElementType(t)!);
          if (isRecordType(t)) collectX(recordElementType(t)!);
        };
        collectX(f.type);
      }
    }
    for (const u of svc.unions) {
      for (const v of u.variants) {
        const collectX = (t: Type) => {
          if ((t.kind === "Model" || t.kind === "Enum") && (t as any).name) {
            const ns = rbModelNs.get((t as any).name);
            if (ns && ns !== svc.serviceName) xrefNs.add(ns);
          }
          if (isArrayType(t)) collectX(arrayElementType(t)!);
          if (isRecordType(t)) collectX(recordElementType(t)!);
        };
        collectX(v.type);
      }
    }
    for (const ns of [...xrefNs].sort()) {
      L.push(`require_relative '${dottedPathToSnakeCase(ns)}_types'`);
    }

    L.push("");

    // ── RBS lines (generated in parallel) ──────────────────────────────────
    const RbsL: string[] = [];
    RbsL.push("# Generated by @specodec/typespec-emitter-ruby. DO NOT EDIT.");
    RbsL.push("");
    RbsL.push("require 'specodec'");

    const rbsXrefNs = new Set<string>();
    for (const m of svc.models) {
      if (!m.name) continue;
      for (const f of extractFields(m)) {
        const collectR = (t: Type) => {
          if ((t.kind === "Model" || t.kind === "Enum") && (t as any).name) {
            const ns = rbModelNs.get((t as any).name);
            if (ns && ns !== svc.serviceName) rbsXrefNs.add(ns);
          }
          if (isArrayType(t)) collectR(arrayElementType(t)!);
          if (isRecordType(t)) collectR(recordElementType(t)!);
        };
        collectR(f.type);
      }
    }
    for (const u of svc.unions) {
      for (const v of u.variants) {
        const collectR = (t: Type) => {
          if ((t.kind === "Model" || t.kind === "Enum") && (t as any).name) {
            const ns = rbModelNs.get((t as any).name);
            if (ns && ns !== svc.serviceName) rbsXrefNs.add(ns);
          }
          if (isArrayType(t)) collectR(arrayElementType(t)!);
          if (isRecordType(t)) collectR(recordElementType(t)!);
        };
        collectR(v.type);
      }
    }
    for (const ns of [...rbsXrefNs].sort()) {
      RbsL.push(`require_relative '${dottedPathToSnakeCase(ns)}_types'`);
    }

    RbsL.push("");

    for (const m of svc.models) emitModelClass(m, L);
    for (const e of svc.enums) { L.push(...generateEnumCode(e)); L.push(""); }
    for (const u of svc.unions) generateUnionCode(u, L);

    for (const m of svc.models) emitModelRbs(m, RbsL);
    for (const e of svc.enums) emitEnumRbs(e, RbsL);
    for (const u of svc.unions) emitUnionRbs(u, RbsL);

    // Codec registrations
    for (const m of svc.models) {
      if (!m.name) continue;
      const sn = toSnakeCase(m.name);
      L.push(`${m.name}Codec = Specodec::SpecCodec.new(`);
      L.push(`  encode: ${m.name}Methods.method(:write_${sn}),`);
      L.push(`  decode: ${m.name}Methods.method(:decode_${sn}),`);
      L.push(`)`);
      L.push("");
    }

    for (const u of svc.unions) {
      if (!u.name) continue;
      const sn = toSnakeCase(u.name);
      L.push(`${u.name}Codec = Specodec::SpecCodec.new(`);
      L.push(`  encode: ${u.name}Methods.method(:write_${sn}),`);
      L.push(`  decode: ${u.name}Methods.method(:decode_${sn}),`);
      L.push(`)`);
      L.push("");
    }

    const baseName = dottedPathToSnakeCase(svc.serviceName);
    const fileName = `${baseName}_types.rb`;
    const rbsFileName = `${baseName}_types.rbs`;
    await emitFile(program, { path: `${outputDir}/${fileName}`, content: L.join("\n") });
    await emitFile(program, { path: `${outputDir}/${rbsFileName}`, content: RbsL.join("\n") });
  }

  let barrelContent = "# frozen_string_literal: true\n\n# Generated by @specodec/typespec-emitter-ruby. DO NOT EDIT.\n\n";
  barrelContent += "require 'specodec'\n\n";
  for (const svc of services) {
    barrelContent += `require_relative '${dottedPathToSnakeCase(svc.serviceName)}_types'\n`;
  }
  await emitFile(program, { path: `${outputDir}/all_types.rb`, content: barrelContent });
}
