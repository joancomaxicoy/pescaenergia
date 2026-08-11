const MIN_JWT_SECRET_LENGTH = 32;

function requireEnvironmentVariable(name, options = {}) {
  const { minLength = 1 } = options;
  const value = process.env[name];

  if (typeof value !== 'string' || value.trim().length < minLength) {
    throw new Error(
      `${name} és obligatòria i ha de tenir com a mínim ${minLength} caràcters`
    );
  }

  return value;
}

function getJwtSecret() {
  return requireEnvironmentVariable('JWT_SECRET', {
    minLength: MIN_JWT_SECRET_LENGTH
  });
}

module.exports = {
  MIN_JWT_SECRET_LENGTH,
  getJwtSecret,
  requireEnvironmentVariable
};
