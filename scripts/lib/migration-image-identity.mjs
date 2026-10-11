export function inspectMigrationDockerImage(runDocker, image) {
  const records = JSON.parse(String(runDocker(['image', 'inspect', image])));
  const record = records[0];
  if (
    record === undefined ||
    typeof record.Id !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(record.Id)
  )
    throw new Error(`V13_DOCKER_IMAGE_INSPECT_INVALID:${image}`);
  const environment = Array.isArray(record.Config?.Env) ? record.Config.Env : [];
  return Object.freeze({
    imageId: record.Id,
    repoDigests: Array.isArray(record.RepoDigests) ? record.RepoDigests : [],
    postgresVersionEnvironment:
      environment.find((value) => value.startsWith('PG_VERSION='))?.slice('PG_VERSION='.length) ??
      null,
  });
}
