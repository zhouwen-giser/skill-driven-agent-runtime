import core from '../../../contracts/smpp-task-business/v1.3/core.schema.json' with { type: 'json' };
import artifact from '../../../contracts/smpp-task-business/v1.3/artifact.schema.json' with { type: 'json' };
import interaction from '../../../contracts/smpp-task-business/v1.3/interaction.schema.json' with { type: 'json' };
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';

// Upstream has standard JSON Schema metadata outside Ajv's strict annotation vocabulary.
// The fixed schemas still enforce their required fields, enums, and additionalProperties.
const validator = new AjvJsonSchemaValidator({ strict: false });
export function validateSmppPublicContract(
  kind: 'context' | 'artifact' | 'action' | 'input_request' | 'intervention',
  value: unknown,
): boolean {
  const schema =
    kind === 'context'
      ? core.schemas.context
      : kind === 'artifact'
        ? artifact.schema
        : kind === 'action'
          ? interaction.schemas.action
          : kind === 'input_request'
            ? interaction.schemas.requiredInput
            : interaction.schemas.intervention;
  return validator.validate(schema, value).valid;
}
