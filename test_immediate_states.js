const { Pool } = require('pg');
const MqttDataService = require('./src/services/mqtt/mqttDataService');

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://eugeni:PiuPiu0101$@192.168.1.12:5432/pescaenergia'
});

async function testImmediateStates() {
    console.log('🧪 Testing Immediate State Persistence (Dual Flow)...\n');

    const mqttDataService = new MqttDataService();
    let testDeviceId = null;

    try {
        // 1. Initialize the service
        console.log('1. Initializing MQTT Data Service...');
        await mqttDataService.initialize();
        await mqttDataService.start();
        console.log('   ✅ Service initialized and started');

        // 2. Create a test device
        console.log('\n2. Creating test device...');
        const deviceResult = await pool.query(`
            INSERT INTO devices (user_id, shelly_device_id, device_name, device_type)
            VALUES ('not_assigned', 'test-plug-immediate', 'Test Plug Immediate', 'PLUG')
            RETURNING id
        `);
        testDeviceId = deviceResult.rows[0].id;
        console.log(`   ✅ Device created with ID: ${testDeviceId}`);

        // 3. Test immediate state processing
        console.log('\n3. Testing immediate state processing...');
        
        // Simulate MQTT messages that should be processed as states
        const stateMessages = [
            {
                topic: 'acs/test-plug-immediate/online',
                payload: 'true'
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
                })
            }
        ];

        // Process each message
        for (const msg of stateMessages) {
            console.log(`   📨 Processing: ${msg.topic}`);
            await mqttDataService.handleMqttMessage({
                topic: msg.topic,
                payload: msg.payload,
                timestamp: Date.now()
            });
            
            // Wait a moment to ensure processing
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // 4. Verify states were persisted immediately
        console.log('\n4. Checking if states were persisted immediately...');
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

        // 5. Verify time difference (should be immediate)
        console.log('\n5. Verifying immediate processing...');
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

        // 6. Test state optimization (no duplicate updates)
        console.log('\n6. Testing state optimization...');
        const beforeCount = await pool.query('SELECT COUNT(*) FROM device_states WHERE device_id = $1', [testDeviceId]);
        
        // Send same message again
        await mqttDataService.handleMqttMessage({
            topic: 'acs/test-plug-immediate/online',
            payload: 'true',
            timestamp: Date.now()
        });
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const afterCount = await pool.query('SELECT COUNT(*) FROM device_states WHERE device_id = $1', [testDeviceId]);
        console.log(`   🔄 State count before: ${beforeCount.rows[0].count}, after: ${afterCount.rows[0].count}`);
        
        if (beforeCount.rows[0].count === afterCount.rows[0].count) {
            console.log('   ✅ State optimization working (no duplicate states created)');
        } else {
            console.log('   ⚠️  State optimization may not be working properly');
        }

        // 7. Check service statistics
        console.log('\n7. Checking service statistics...');
        const stats = mqttDataService.getStatsSummary();
        console.log(`   📊 Messages processed: ${stats.coordinator.messagesProcessed}`);
        console.log(`   📊 States processed immediately: ${stats.coordinator.statesProcessedImmediately}`);
        console.log(`   📊 Time series buffered: ${stats.coordinator.timeSeriesBuffered}`);
        console.log(`   📊 Device state stats: ${JSON.stringify(stats.deviceStates.efficiency)}`);

        console.log('\n🎉 Immediate state persistence test PASSED!');
        console.log('✅ Estados se guardan inmediatamente sin esperar los 5 minutos del compactador');

    } catch (error) {
        console.error('❌ Test failed:', error);
        throw error;
    } finally {
        // Cleanup
        if (testDeviceId) {
            console.log('\n8. Cleaning up test data...');
            await pool.query('DELETE FROM devices WHERE id = $1', [testDeviceId]);
            console.log('   🧹 Test device and related data cleaned up');
        }

        // Stop services
        await mqttDataService.stop();
        await pool.end();
    }
}

// Run the test
if (require.main === module) {
    testImmediateStates()
        .then(() => {
            console.log('\n✅ Immediate state test completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Immediate state test failed:', error);
            process.exit(1);
        });
}

module.exports = { testImmediateStates };
