/**
 * Script de prueba para el endpoint de asignación de CUPS
 * 
 * Este script prueba todos los casos de uso del endpoint de asignación de CUPS:
 * - Usuario normal se asigna CUPS
 * - Usuario normal intenta asignar CUPS ya ocupado
 * - Admin asigna CUPS a usuario específico
 * - Admin reasigna CUPS de un usuario a otro
 * - Consulta de información de CUPS
 * - Lista de CUPS (solo admin)
 * - Desasignación de CUPS (solo admin)
 */

const axios = require('axios');

const API_BASE = 'http://localhost:3000/api';

// Configuración de prueba
const TEST_CONFIG = {
  admin: {
    email: 'admin@pescaenergia.com',
    password: 'admin123'
  },
  user1: {
    email: 'usuario1@test.com',
    password: 'password123',
    name: 'Usuario Test 1'
  },
  user2: {
    email: 'usuario2@test.com',
    password: 'password123',
    name: 'Usuario Test 2'
  },
  testCups: 'ES0031446450479001ZC0F'
};

let tokens = {};
let userIds = {};

// Función auxiliar para hacer requests autenticados
async function authenticatedRequest(method, url, data, userType = 'admin') {
  const token = tokens[userType];
  if (!token) {
    throw new Error(`No hay token para ${userType}`);
  }

  const config = {
    method,
    url: `${API_BASE}${url}`,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  if (data) {
    config.data = data;
  }

  return axios(config);
}

// Función para registrar y autenticar usuarios
async function setupUsers() {
  console.log('🔧 Configurando usuarios de prueba...');

  try {
    // Intentar login del admin (asumiendo que ya existe)
    try {
      const adminLogin = await axios.post(`${API_BASE}/auth/login`, {
        email: TEST_CONFIG.admin.email,
        password: TEST_CONFIG.admin.password
      });
      tokens.admin = adminLogin.data.token;
      userIds.admin = adminLogin.data.user.id;
      console.log('✅ Admin autenticado');
    } catch (error) {
      console.log('❌ Error autenticando admin:', error.response?.data?.error || error.message);
      return false;
    }

    // Registrar y autenticar usuario1
    try {
      const user1Register = await axios.post(`${API_BASE}/auth/register`, TEST_CONFIG.user1);
      tokens.user1 = user1Register.data.token;
      userIds.user1 = user1Register.data.user.id;
      console.log('✅ Usuario1 registrado y autenticado');
    } catch (error) {
      // Si ya existe, intentar login
      try {
        const user1Login = await axios.post(`${API_BASE}/auth/login`, {
          email: TEST_CONFIG.user1.email,
          password: TEST_CONFIG.user1.password
        });
        tokens.user1 = user1Login.data.token;
        userIds.user1 = user1Login.data.user.id;
        console.log('✅ Usuario1 autenticado (ya existía)');
      } catch (loginError) {
        console.log('❌ Error con usuario1:', loginError.response?.data?.error || loginError.message);
        return false;
      }
    }

    // Registrar y autenticar usuario2
    try {
      const user2Register = await axios.post(`${API_BASE}/auth/register`, TEST_CONFIG.user2);
      tokens.user2 = user2Register.data.token;
      userIds.user2 = user2Register.data.user.id;
      console.log('✅ Usuario2 registrado y autenticado');
    } catch (error) {
      // Si ya existe, intentar login
      try {
        const user2Login = await axios.post(`${API_BASE}/auth/login`, {
          email: TEST_CONFIG.user2.email,
          password: TEST_CONFIG.user2.password
        });
        tokens.user2 = user2Login.data.token;
        userIds.user2 = user2Login.data.user.id;
        console.log('✅ Usuario2 autenticado (ya existía)');
      } catch (loginError) {
        console.log('❌ Error con usuario2:', loginError.response?.data?.error || loginError.message);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.log('❌ Error configurando usuarios:', error.message);
    return false;
  }
}

// Limpiar CUPS de prueba antes de empezar
async function cleanupTestCups() {
  console.log('🧹 Limpiando CUPS de prueba...');
  
  try {
    // Intentar desasignar el CUPS de prueba si existe
    await authenticatedRequest('POST', `/cups/${TEST_CONFIG.testCups}/unassign`);
    console.log('✅ CUPS de prueba desasignado');
  } catch (error) {
    // Es normal que falle si el CUPS no existe o no está asignado
    console.log('ℹ️ CUPS de prueba no necesitaba limpieza');
  }
}

// Prueba 1: Usuario normal se asigna CUPS
async function test1_UserAssignsCups() {
  console.log('\n📋 Prueba 1: Usuario normal se asigna CUPS');
  
  try {
    const response = await authenticatedRequest('POST', '/cups/assign', {
      cups: TEST_CONFIG.testCups
    }, 'user1');

    console.log('✅ CUPS asignado exitosamente');
    console.log('📄 Respuesta:', JSON.stringify(response.data, null, 2));
    return true;
  } catch (error) {
    console.log('❌ Error:', error.response?.data?.error || error.message);
    return false;
  }
}

// Prueba 2: Usuario normal intenta asignar CUPS ya ocupado
async function test2_UserTriesAssignOccupiedCups() {
  console.log('\n📋 Prueba 2: Usuario normal intenta asignar CUPS ya ocupado');
  
  try {
    const response = await authenticatedRequest('POST', '/cups/assign', {
      cups: TEST_CONFIG.testCups
    }, 'user2');

    console.log('❌ No debería haber funcionado');
    return false;
  } catch (error) {
    if (error.response?.status === 400) {
      console.log('✅ Error esperado:', error.response.data.error);
      return true;
    } else {
      console.log('❌ Error inesperado:', error.response?.data?.error || error.message);
      return false;
    }
  }
}

// Prueba 3: Admin reasigna CUPS a otro usuario
async function test3_AdminReassignsCups() {
  console.log('\n📋 Prueba 3: Admin reasigna CUPS a otro usuario');
  
  try {
    const response = await authenticatedRequest('POST', '/cups/assign', {
      cups: TEST_CONFIG.testCups,
      user_id: userIds.user2
    }, 'admin');

    console.log('✅ CUPS reasignado exitosamente por admin');
    console.log('📄 Respuesta:', JSON.stringify(response.data, null, 2));
    return true;
  } catch (error) {
    console.log('❌ Error:', error.response?.data?.error || error.message);
    return false;
  }
}

// Prueba 4: Consultar información de CUPS
async function test4_GetCupsInfo() {
  console.log('\n📋 Prueba 4: Consultar información de CUPS');
  
  try {
    const response = await authenticatedRequest('GET', `/cups/${TEST_CONFIG.testCups}/info`, null, 'admin');

    console.log('✅ Información de CUPS obtenida');
    console.log('📄 Respuesta:', JSON.stringify(response.data, null, 2));
    return true;
  } catch (error) {
    console.log('❌ Error:', error.response?.data?.error || error.message);
    return false;
  }
}

// Prueba 5: Usuario normal intenta ver CUPS de otro usuario
async function test5_UserTriesViewOthersCups() {
  console.log('\n📋 Prueba 5: Usuario normal intenta ver CUPS de otro usuario');
  
  try {
    const response = await authenticatedRequest('GET', `/cups/${TEST_CONFIG.testCups}/info`, null, 'user1');

    console.log('❌ No debería haber funcionado');
    return false;
  } catch (error) {
    if (error.response?.status === 403) {
      console.log('✅ Error esperado:', error.response.data.error);
      return true;
    } else {
      console.log('❌ Error inesperado:', error.response?.data?.error || error.message);
      return false;
    }
  }
}

// Prueba 6: Listar todos los CUPS (solo admin)
async function test6_AdminListsCups() {
  console.log('\n📋 Prueba 6: Admin lista todos los CUPS');
  
  try {
    const response = await authenticatedRequest('GET', '/cups/list', null, 'admin');

    console.log('✅ Lista de CUPS obtenida');
    console.log('📄 Estadísticas:', {
      total: response.data.total,
      assigned: response.data.assigned,
      unassigned: response.data.unassigned
    });
    return true;
  } catch (error) {
    console.log('❌ Error:', error.response?.data?.error || error.message);
    return false;
  }
}

// Prueba 7: Usuario normal intenta listar CUPS
async function test7_UserTriesListCups() {
  console.log('\n📋 Prueba 7: Usuario normal intenta listar CUPS');
  
  try {
    const response = await authenticatedRequest('GET', '/cups/list', null, 'user1');

    console.log('❌ No debería haber funcionado');
    return false;
  } catch (error) {
    if (error.response?.status === 403) {
      console.log('✅ Error esperado:', error.response.data.error);
      return true;
    } else {
      console.log('❌ Error inesperado:', error.response?.data?.error || error.message);
      return false;
    }
  }
}

// Prueba 8: Admin desasigna CUPS
async function test8_AdminUnassignsCups() {
  console.log('\n📋 Prueba 8: Admin desasigna CUPS');
  
  try {
    const response = await authenticatedRequest('POST', `/cups/${TEST_CONFIG.testCups}/unassign`, null, 'admin');

    console.log('✅ CUPS desasignado exitosamente');
    console.log('📄 Respuesta:', JSON.stringify(response.data, null, 2));
    return true;
  } catch (error) {
    console.log('❌ Error:', error.response?.data?.error || error.message);
    return false;
  }
}

// Función principal
async function runTests() {
  console.log('🚀 Iniciando pruebas del endpoint de asignación de CUPS\n');

  // Configurar usuarios
  const usersReady = await setupUsers();
  if (!usersReady) {
    console.log('❌ No se pudieron configurar los usuarios. Abortando pruebas.');
    return;
  }

  // Limpiar estado inicial
  await cleanupTestCups();

  // Ejecutar pruebas
  const tests = [
    test1_UserAssignsCups,
    test2_UserTriesAssignOccupiedCups,
    test3_AdminReassignsCups,
    test4_GetCupsInfo,
    test5_UserTriesViewOthersCups,
    test6_AdminListsCups,
    test7_UserTriesListCups,
    test8_AdminUnassignsCups
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await test();
    if (result) {
      passed++;
    } else {
      failed++;
    }
    
    // Pausa entre pruebas
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Resumen
  console.log('\n📊 RESUMEN DE PRUEBAS');
  console.log('='.repeat(50));
  console.log(`✅ Pruebas exitosas: ${passed}`);
  console.log(`❌ Pruebas fallidas: ${failed}`);
  console.log(`📈 Porcentaje de éxito: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

  if (failed === 0) {
    console.log('\n🎉 ¡Todas las pruebas pasaron exitosamente!');
  } else {
    console.log('\n⚠️ Algunas pruebas fallaron. Revisar la implementación.');
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  runTests().catch(error => {
    console.error('💥 Error ejecutando pruebas:', error.message);
    process.exit(1);
  });
}

module.exports = { runTests };
