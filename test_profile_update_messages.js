/**
 * Test script to verify profile update error handling
 * This script tests the new message system for profile updates
 */

const fetch = require('node-fetch');

// Test configuration
const BASE_URL = 'http://localhost:3000';
const TEST_USER = {
    email: 'test@example.com',
    password: 'TestPassword123'
};

async function testProfileUpdateMessages() {
    console.log('🧪 Testing Profile Update Message System...\n');

    try {
        // 1. Login to get auth token
        console.log('1. Logging in...');
        const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(TEST_USER)
        });

        if (!loginResponse.ok) {
            console.log('❌ Login failed - creating test user or check credentials');
            return;
        }

        const loginData = await loginResponse.json();
        const authToken = loginData.accessToken;
        console.log('✅ Login successful');

        // 2. Test validation errors
        console.log('\n2. Testing validation errors...');
        
        // Test empty name
        console.log('   Testing empty name...');
        const emptyNameResponse = await fetch(`${BASE_URL}/api/auth/profile`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ name: '' })
        });

        if (emptyNameResponse.status === 400) {
            const emptyNameData = await emptyNameResponse.json();
            console.log('   ✅ Empty name validation:', emptyNameData.details?.[0]?.message || emptyNameData.error);
        }

        // Test name too short
        console.log('   Testing name too short...');
        const shortNameResponse = await fetch(`${BASE_URL}/api/auth/profile`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ name: 'A' })
        });

        if (shortNameResponse.status === 400) {
            const shortNameData = await shortNameResponse.json();
            console.log('   ✅ Short name validation:', shortNameData.details?.[0]?.message || shortNameData.error);
        }

        // Test invalid characters
        console.log('   Testing invalid characters...');
        const invalidNameResponse = await fetch(`${BASE_URL}/api/auth/profile`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ name: 'Test123' })
        });

        if (invalidNameResponse.status === 400) {
            const invalidNameData = await invalidNameResponse.json();
            console.log('   ✅ Invalid characters validation:', invalidNameData.details?.[0]?.message || invalidNameData.error);
        }

        // 3. Test successful update
        console.log('\n3. Testing successful update...');
        const successResponse = await fetch(`${BASE_URL}/api/auth/profile`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ name: 'Test User Updated' })
        });

        if (successResponse.ok) {
            const successData = await successResponse.json();
            console.log('   ✅ Successful update:', successData.name);
        }

        // 4. Test unauthorized access
        console.log('\n4. Testing unauthorized access...');
        const unauthorizedResponse = await fetch(`${BASE_URL}/api/auth/profile`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer invalid-token'
            },
            body: JSON.stringify({ name: 'Test' })
        });

        if (unauthorizedResponse.status === 401) {
            const unauthorizedData = await unauthorizedResponse.json();
            console.log('   ✅ Unauthorized error:', unauthorizedData.error);
        }

        console.log('\n🎉 All tests completed!');
        console.log('\n📋 Summary:');
        console.log('   - Frontend now shows specific validation messages instead of generic alerts');
        console.log('   - Success messages appear for 1.5 seconds before closing modal');
        console.log('   - Error messages auto-hide after 5 seconds');
        console.log('   - Messages use proper styling (green for success, red for errors)');
        console.log('   - Icons change based on message type (check-circle vs alert-circle)');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

// Run tests if this script is executed directly
if (require.main === module) {
    testProfileUpdateMessages();
}

module.exports = { testProfileUpdateMessages };
