/** Schema explicitness is a publication/authoring rule; historical enabled Skills remain readable. */
export function skillSchemaContractErrors(
  schema: unknown,
  label: 'input' | 'output',
): readonly string[] {
  const errors: string[] = [];
  let visited = 0;
  const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const refs = new Set<string>();
  const inspect = (value: unknown, path: string, depth: number, allowEmptyInput: boolean): void => {
    if (++visited > 2048 || depth > 64) {
      errors.push(`${path}: schema complexity exceeds the supported limit`);
      return;
    }
    if (!record(value)) {
      errors.push(`${path}: an explicit usable schema is required`);
      return;
    }
    if (Object.hasOwn(value, 'const') || (Array.isArray(value['enum']) && value['enum'].length > 0))
      return;
    const ref = value['$ref'];
    if (typeof ref === 'string') {
      if (!ref.startsWith('#/')) {
        errors.push(`${path}: only local schema references are supported`);
        return;
      }
      if (refs.has(ref)) return;
      refs.add(ref);
      let target: unknown = schema;
      for (const segment of ref.slice(2).split('/'))
        target = record(target)
          ? target[segment.replaceAll('~1', '/').replaceAll('~0', '~')]
          : undefined;
      inspect(target, `${path}.$ref`, depth + 1, allowEmptyInput);
      return;
    }
    for (const key of ['oneOf', 'anyOf'] as const) {
      const variants = value[key];
      if (Array.isArray(variants) && variants.length > 0) {
        variants.forEach((variant, index) => {
          inspect(variant, `${path}.${key}[${String(index)}]`, depth + 1, allowEmptyInput);
        });
        return;
      }
    }
    const types = Array.isArray(value['type']) ? value['type'] : [value['type']];
    if (
      types.some(
        (type) =>
          !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(
            String(type),
          ),
      )
    ) {
      errors.push(`${path}: explicit type, const, enum or constrained alternatives are required`);
      return;
    }
    if (types.includes('object')) {
      const properties = record(value['properties']) ? value['properties'] : {};
      const patterns = record(value['patternProperties']) ? value['patternProperties'] : {};
      const dictionary = record(value['additionalProperties']);
      const named = Object.keys(properties).length > 0 || Object.keys(patterns).length > 0;
      const noParameters =
        allowEmptyInput &&
        (value['additionalProperties'] === false || value['maxProperties'] === 0);
      if (!named && !dictionary && !noParameters)
        errors.push(`${path}: an open empty object contract is not explicit`);
      for (const [key, property] of Object.entries(properties))
        inspect(property, `${path}.properties.${key}`, depth + 1, false);
      for (const [key, property] of Object.entries(patterns))
        inspect(property, `${path}.patternProperties.${key}`, depth + 1, false);
      if (dictionary)
        inspect(value['additionalProperties'], `${path}.additionalProperties`, depth + 1, false);
      if (Array.isArray(value['required']))
        for (const key of value['required'])
          if (
            typeof key === 'string' &&
            !Object.hasOwn(properties, key) &&
            !dictionary &&
            Object.keys(patterns).length === 0
          )
            errors.push(`${path}: required field ${key} has no declared contract`);
    }
    if (types.includes('array')) {
      const tuple = value['prefixItems'];
      if (Array.isArray(tuple) && tuple.length > 0) {
        tuple.forEach((item, index) => {
          inspect(item, `${path}.prefixItems[${String(index)}]`, depth + 1, false);
        });
        if (value['items'] !== false) inspect(value['items'], `${path}.items`, depth + 1, false);
      } else inspect(value['items'], `${path}.items`, depth + 1, false);
    }
  };
  inspect(schema, label, 0, label === 'input');
  return errors;
}
