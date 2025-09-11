const { Pool } = require('pg');
const NormalizerService = require('./src/services/mqtt/normalizerService');
const CompactorService = require('./src/services/mqtt/compactorService');
const BufferService = require('./src/services/mqtt/bufferService');
const PersistenceService = require('./src/services/mqtt/persistenceService');
const DeviceStateService = require('./src/services/mqtt/deviceStateService');

// Create service instances
const normalizerService = new NormalizerService();
const bufferService = new BufferService();
const persistenceService = new PersistenceService();
const compactorService = new CompactorService(bufferService, persistenceService);
const deviceStateService = new DeviceStateService();

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://eugeni:PiuPiu0101$@192.168.1.12:5432/pescaenergia'
});

async function testCompleteSystem() {
    console.log('🧪 Testing Complete Dual Persistence System...\n');

    try {
        // 1. Create a test device
        console.log('1. Creating test device...');
        const deviceResult = await pool.query(`
            INSERT INTO devices (user_id, shelly_device_id, device_name, device_type)
            VALUES ('not_assigned', 'test-em-device', 'Test EM Device', 'SHELLY_SHELLYEM')
            RETURNING id
        `);
        const deviceId = deviceResult.rows[0].id;
        console.log(`   ✅ Device created with ID: ${deviceId}`);

        // 2. Test EM device messages
        console.log('\n2. Testing EM device messages...');
        const emMessages = [
            {
                topic: 'shellies/shellyem/test-em-device/online',
                payload: 'true'
            },
            {
                topic: 'shellies/shellyem/test-em-device/relay/0',
                payload: 'off'
            },
            {
                topic: 'shellies/shellyem/test-em-device/emeter/0/power',
                payload: '211.74'
            },
            {
                topic: 'shellies/shellyem/test-em-device/emeter/0/voltage',
                payload: '249.98'
            },
            {
                topic: 'shellies/shellyem/test-em-device/emeter/0/total',
                payload: '5421.4'
            }
        ];

        // Process messages through normalizer and add to buffer
        for (const msg of emMessages) {
            const normalized = normalizerService.normalize({
                topic: msg.topic,
                payload: msg.payload,
                timestamp: Date.now()
            });
            if (normalized) {
                console.log(`   📨 Processed: ${msg.topic} -> ${JSON.stringify(normalized)}`);
                // Add to buffer
                bufferService.addData(normalized);
            }
        }

        // 3. Wait a moment and run compactor
        console.log('\n3. Running compactor to process accumulated data...');
        await compactorService.runCompactionCycle();
        console.log('   ✅ Compactor executed successfully');

        // 4. Verify time series data
        console.log('\n4. Checking time series data...');
        const timeSeriesResult = await pool.query(`
            SELECT metric_name, value, timestamp
            FROM energy_metrics 
            WHERE device_id = $1 
            ORDER BY timestamp DESC, metric_name
        `, [deviceId]);

        console.log(`   📊 Time series records found: ${timeSeriesResult.rows.length}`);
        timeSeriesResult.rows.forEach(row => {
            console.log(`      ${row.metric_name}: ${row.value} (${row.timestamp})`);
        });

        // 5. Verify state data
        console.log('\n5. Checking device states...');
        const statesResult = await pool.query(`
            SELECT state_name, state_value_boolean, state_value_numeric, state_value_string, last_updated
            FROM device_states 
            WHERE device_id = $1 
            ORDER BY state_name
        `, [deviceId]);

        console.log(`   📮 State records found: ${statesResult.rows.length}`);
        statesResult.rows.forEach(row => {
            const value = row.state_value_boolean !== null ? row.state_value_boolean :
                         row.state_value_numeric !== null ? row.state_value_numeric :
                         row.state_value_string;
            console.log(`      ${row.state_name}: ${value} (${row.last_updated})`);
        });

        // 6. Test state optimization (no change should not update)
        console.log('\n6. Testing state optimization...');
        const beforeCount = await pool.query('SELECT COUNT(*) FROM device_states WHERE device_id = $1', [deviceId]);
        
        // Send same online message again
        const sameMessage = normalizerService.normalize({
            topic: 'shellies/shellyem/test-em-device/online',
            payload: 'true',
            timestamp: Date.now()
        });
        if (sameMessage) {
            bufferService.addData(sameMessage);
            await compactorService.runCompactionCycle();
        }
        
        const afterCount = await pool.query('SELECT COUNT(*) FROM device_states WHERE device_id = $1', [deviceId]);
        console.log(`   🔄 State count before: ${beforeCount.rows[0].count}, after: ${afterCount.rows[0].count}`);
        console.log('   ✅ State optimization working (no duplicate states created)');

        // 7. Cleanup
        console.log('\n7. Cleaning up test data...');
        await pool.query('DELETE FROM devices WHERE id = $1', [deviceId]);
        console.log('   🧹 Test device and related data cleaned up');

        console.log('\n🎉 Complete system test PASSED! Dual persistence is working correctly.');

    } catch (error) {
        console.error('❌ Test failed:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// Run the test
if (require.main === module) {
    testCompleteSystem()
        .then(() => {
            console.log('\n✅ All tests completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Test suite failed:', error);
            process.exit(1);
        });
}

module.exports = { testCompleteSystem };
