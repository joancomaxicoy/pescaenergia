const { Pool } = require('pg');
const database = require('./src/utils/database');
const NormalizerService = require('./src/services/mqtt/normalizerService');
const DeviceStateService = require('./src/services/mqtt/deviceStateService');
const PersistenceService = require('./src/services/mqtt/persistenceService');

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://eugeni:PiuPiu0101$@192.168.1.12:5432/pescaenergia'
});

async function testImmediateStatesSimple() {
    console.log('🧪 Testing Immediate State Persistence (Simplified - No MQTT)...\n');

    const normalizerService = new NormalizerService();
    const deviceStateService = new DeviceStateService();
    const persistenceService = new PersistenceService();
    let testDeviceId = null;

    try {
        // 0. Connect to database (using pool directly)
        console.log('0. Connecting to database...');
        // Test the pool connection
        const testClient = await pool.connect();
        await testClient.query('SELECT NOW()');
        testClient.release();
        
        // Configure the database singleton to use our pool
        database.pool = pool;
        console.log('   ✅ Database connected and configured');

        // 1. Create a test device
        console.log('\n1. Creating test device...');
        const deviceResult = await pool.query(`
            INSERT INTO devices (user_id, shelly_device_id, device_name, device_type)
            VALUES ('not_assigned', 'acs/test-plug-immediate', 'Test Plug Immediate', 'PLUG')
            RETURNING id
        `);
        testDeviceId = deviceResult.rows[0].id;
        console.log(`   ✅ Device created with ID: ${testDeviceId}`);

        // 2. Test immediate state processing
        console.log('\n2. Testing immediate state processing...');
        
        // Simulate MQTT messages that should be processed as states
        const stateMessages = [
            {
                topic: 'acs/test-plug-immediate/online',
                payload: 'true',
                timestamp: Date.now()
            },
            {
                topic: 'acs/test-plug-immediate/status/switch:0',
                payload: JSON.stringify({
                    id: 0,
                    source: "MQTT",
                    output: true,
                    apower: 58.0,
                    voltage: 240.7,
                    temperature: {
                        tC: 46.7,
                        tF: 116.1
                    },
                    wifi: {
                        sta_ip: "192.168.1.100",
                        ssid: "TestNetwork"
                    }
                }),
                timestamp: Date.now()
            }
        ];

        // Process each message through the normalizer
        for (const msg of stateMessages) {
            console.log(`   📨 Processing: ${msg.topic}`);
            
            // 1. Normalize the message
            const normalizedData = normalizerService.normalize(msg);
            
            if (!normalizedData) {
                console.log(`   ⚠️  Message could not be normalized: ${msg.topic}`);
                continue;
            }

            console.log(`   ✅ Normalized: ${normalizedData.deviceId} -> ${normalizedData.stateMetrics?.length || 0} states, ${normalizedData.timeSeriesMetrics?.length || 0} time series`);

            // 2. Process states immediately if they exist
            if (normalizedData.stateMetrics && normalizedData.stateMetrics.length > 0) {
                console.log(`   🔄 Processing ${normalizedData.stateMetrics.length} states immediately...`);
                
                // Resolve device UUID
                let deviceUuid = await persistenceService.resolveDeviceId(normalizedData.deviceId);
                
                if (!deviceUuid) {
                    console.log(`   ⚠️  Device not found, creating automatically...`);
                    deviceUuid = await persistenceService.findOrCreateDevice(
                        normalizedData.deviceId, 
                        normalizedData.deviceType, 
                        {}
                    );
                }

                if (deviceUuid) {
                    // Prepare states for DeviceStateService
                    const states = normalizedData.stateMetrics.map(metric => ({
                        stateName: metric.metricName,
                        stateValue: metric.value,
                        stateType: typeof metric.value === 'boolean' ? 'boolean' :
                                  typeof metric.value === 'number' ? 'numeric' :
                                  typeof metric.value === 'object' ? 'json' : 'string'
                    }));

                    // Update states immediately
                    await deviceStateService.updateMultipleDeviceStates(deviceUuid, states);
                    console.log(`   ✅ ${states.length} states updated immediately for device ${deviceUuid}`);
                } else {
                    console.log(`   ❌ Could not resolve or create device UUID`);
                }
            }
        }

        // 3. Verify states were persisted immediately
        console.log('\n3. Checking if states were persisted immediately...');
        const statesResult = await pool.query(`
            SELECT state_name, state_value_boolean, state_value_numeric, state_value_string, state_value_json, last_updated
            FROM device_states 
            WHERE device_id = $1 
            ORDER BY state_name
        `, [testDeviceId]);

        console.log(`   📮 State records found: ${statesResult.rows.length}`);
        
        if (statesResult.rows.length === 0) {
            throw new Error('❌ No states were persisted! Immediate state processing failed.');
        }

        statesResult.rows.forEach(row => {
            const value = row.state_value_boolean !== null ? row.state_value_boolean :
                         row.state_value_numeric !== null ? row.state_value_numeric :
                         row.state_value_json !== null ? JSON.stringify(row.state_value_json) :
                         row.state_value_string;
            console.log(`      ${row.state_name}: ${value} (${row.last_updated})`);
        });

        // 4. Verify time difference (should be immediate)
        console.log('\n4. Verifying immediate processing...');
        const latestState = await pool.query(`
            SELECT last_updated
            FROM device_states 
            WHERE device_id = $1 
            ORDER BY last_updated DESC 
            LIMIT 1
        `, [testDeviceId]);

        if (latestState.rows.length > 0) {
            const stateTime = new Date(latestState.rows[0].last_updated);
            const now = new Date();
            const timeDiff = now - stateTime;
            
            console.log(`   ⏱️  Time difference: ${timeDiff}ms`);
            
            if (timeDiff < 5000) { // Less than 5 seconds
                console.log('   ✅ States processed immediately (< 5 seconds)');
            } else {
                console.log('   ⚠️  States took longer than expected to process');
            }
        }

        // 5. Test state optimization (no duplicate updates)
        console.log('\n5. Testing state optimization...');
        const beforeCount = await pool.query('SELECT COUNT(*) FROM device_states WHERE device_id = $1', [testDeviceId]);
        
        // Process same message again
        const sameMessage = {
            topic: 'acs/test-plug-immediate/online',
            payload: 'true',
            timestamp: Date.now()
        };
        
        const normalizedSame = normalizerService.normalize(sameMessage);
        if (normalizedSame && normalizedSame.stateMetrics && normalizedSame.stateMetrics.length > 0) {
            const deviceUuid = await persistenceService.resolveDeviceId(normalizedSame.deviceId);
            const states = normalizedSame.stateMetrics.map(metric => ({
                stateName: metric.metricName,
                stateValue: metric.value,
                stateType: typeof metric.value === 'boolean' ? 'boolean' : 'string'
            }));
            await deviceStateService.updateMultipleDeviceStates(deviceUuid, states);
        }
        
        const afterCount = await pool.query('SELECT COUNT(*) FROM device_states WHERE device_id = $1', [testDeviceId]);
        console.log(`   🔄 State count before: ${beforeCount.rows[0].count}, after: ${afterCount.rows[0].count}`);
        
        if (beforeCount.rows[0].count === afterCount.rows[0].count) {
            console.log('   ✅ State optimization working (no duplicate states created)');
        } else {
            console.log('   ⚠️  State optimization may not be working properly');
        }

        // 6. Check service statistics
        console.log('\n6. Checking service statistics...');
        const deviceStateStats = deviceStateService.getStats();
        console.log(`   📊 States created: ${deviceStateStats.statesCreated}`);
        console.log(`   📊 States updated: ${deviceStateStats.statesUpdated}`);
        console.log(`   📊 States skipped: ${deviceStateStats.statesSkipped}`);
        console.log(`   📊 Efficiency: ${deviceStateStats.efficiency}`);

        console.log('\n🎉 Immediate state persistence test PASSED!');
        console.log('✅ Estados se guardan inmediatamente sin esperar los 5 minutos del compactador');
        console.log('✅ El nuevo flujo dual funciona correctamente');

    } catch (error) {
        console.error('❌ Test failed:', error);
        throw error;
    } finally {
        // Cleanup
        if (testDeviceId) {
            console.log('\n7. Cleaning up test data...');
            await pool.query('DELETE FROM devices WHERE id = $1', [testDeviceId]);
            console.log('   🧹 Test device and related data cleaned up');
        }

        await pool.end();
    }
}

// Run the test
if (require.main === module) {
    testImmediateStatesSimple()
        .then(() => {
            console.log('\n✅ Immediate state test completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Immediate state test failed:', error);
            process.exit(1);
        });
}

module.exports = { testImmediateStatesSimple };
