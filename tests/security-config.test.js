const {
  MIN_JWT_SECRET_LENGTH,
  getJwtSecret,
  requireEnvironmentVariable
} = require('../src/config/security');
const AdminSeeder = require('../src/seeders/adminSeeder');

describe('configuració segura', () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalAdminUsers = process.env.ADMIN_SEEDER_USERS_JSON;

  afterEach(() => {
    process.env.JWT_SECRET = originalJwtSecret;

    if (originalAdminUsers === undefined) {
      delete process.env.ADMIN_SEEDER_USERS_JSON;
    } else {
      process.env.ADMIN_SEEDER_USERS_JSON = originalAdminUsers;
    }
  });

  test('rebutja variables obligatòries absents', () => {
    delete process.env.REQUIRED_TEST_SECRET;

    expect(() => requireEnvironmentVariable('REQUIRED_TEST_SECRET')).toThrow(
      'REQUIRED_TEST_SECRET és obligatòria'
    );
  });

  test('rebutja secrets JWT massa curts', () => {
    process.env.JWT_SECRET = 'massa-curt';

    expect(() => getJwtSecret()).toThrow(
      `com a mínim ${MIN_JWT_SECRET_LENGTH} caràcters`
    );
  });

  test('accepta un secret JWT prou llarg', () => {
    const secret = 'a'.repeat(MIN_JWT_SECRET_LENGTH);
    process.env.JWT_SECRET = secret;

    expect(getJwtSecret()).toBe(secret);
  });

  test('el seeder exigeix administradors injectats per l\'entorn', () => {
    delete process.env.ADMIN_SEEDER_USERS_JSON;
    const seeder = new AdminSeeder();

    expect(() => seeder.loadAdminsFromEnvironment()).toThrow(
      'ADMIN_SEEDER_USERS_JSON és obligatòria'
    );
  });

  test('el seeder força el rol administrador', () => {
    process.env.ADMIN_SEEDER_USERS_JSON = JSON.stringify([
      {
        email: 'admin@example.test',
        name: 'Admin de prova',
        password: 'contrasenya-de-prova-llarga',
        role: 'user'
      }
    ]);

    const [admin] = new AdminSeeder().loadAdminsFromEnvironment();

    expect(admin.role).toBe('admin');
  });
});
