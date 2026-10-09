// Validate the bounded subset used by the reviewed public SDH API contracts.
// DSH's schema DSL exposes types/enums/items; numeric and length limits are
// enforced here before any network request as well as described to the model.
export function validateSchema(schema, input, path = 'arguments') {
  const fail = detail => { throw new Error(`SDH_INVALID_ARGUMENT: ${path} ${detail}.`); };
  let value = input;
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('must be an object');
    const result = {};
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key)) fail(`has unknown parameter ${key}`);
    }
    for (const [key, spec] of Object.entries(schema.properties)) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) {
        if (schema.required?.includes(key)) fail(`requires ${key}`);
      } else result[key] = validateSchema(spec, value[key], `${path}.${key}`);
    }
    return result;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('must be an array');
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) fail('has an invalid item count');
    // Array.from visits holes as undefined so sparse inputs also fail validation.
    value = Array.from(value, (item, i) => validateSchema(schema.items, item, `${path}[${i}]`));
    if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) fail('must contain unique items');
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') fail('must be a string');
    value = value.trim();
    if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) fail('has an invalid length');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail('contains unsupported characters');
  } else if (schema.type === 'integer' || schema.type === 'number') {
    if (!Number.isFinite(value) || (schema.type === 'integer' && !Number.isSafeInteger(value))) fail(`must be a finite ${schema.type}`);
    if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity) ||
        (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum)) fail('is outside the allowed range');
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') fail('must be a boolean');
  } else fail('uses an unsupported schema type');
  if (schema.enum && !schema.enum.includes(value)) fail('has an unsupported value');
  return value;
}

export function dshParameters(schema) {
  const convert = spec => {
    const constraints = ['minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'minItems', 'maxItems', 'uniqueItems']
      .filter(k => spec[k] !== undefined).map(k => `${k}=${spec[k]}`);
    return { type: spec.type,
      description: [spec.description, constraints.join(', ')].filter(Boolean).join('; '),
      ...(spec.enum ? { enum: spec.enum } : {}),
      ...(spec.items ? { items: convert(spec.items) } : {}) };
  };
  return Object.fromEntries(Object.entries(schema.properties).map(([key, spec]) =>
    [key, { ...convert(spec), ...(schema.required?.includes(key) ? { required: true } : {}) }]));
}
