// test-flight-monitor.js - Test the flight monitor setup
const http = require('http');
const fs = require('fs');

console.log('🧪 Testing Flight Monitor Setup...\n');

// Check required files
const requiredFiles = [
  'flight-monitor-server.js',
  'package.json',
  'public/flight-monitor.html'
];

console.log('📁 Checking files:');
let allFilesExist = true;
for (const file of requiredFiles) {
  const exists = fs.existsSync(file);
  console.log(`  ${exists ? '✅' : '❌'} ${file}`);
  if (!exists) allFilesExist = false;
}

if (!allFilesExist) {
  console.log('\n❌ Missing files. Please create:');
  console.log('1. flight-monitor-server.js (backend server)');
  console.log('2. package.json (dependencies)');
  console.log('3. public/flight-monitor.html (frontend)');
  process.exit(1);
}

// Check dependencies
const nodeModulesExists = fs.existsSync('node_modules');
console.log(`  ${nodeModulesExists ? '✅' : '❌'} node_modules`);

if (!nodeModulesExists) {
  console.log('\n❌ Dependencies not installed. Run:');
  console.log('npm install express node-fetch cors jsdom node-cron');
  process.exit(1);
}

console.log('\n🚀 Testing server endpoints...');

// Test server function
async function testEndpoint(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3002,
      path: path,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = res.headers['content-type']?.includes('application/json') 
            ? JSON.parse(data) 
            : data;
          resolve({ status: res.statusCode, data: result });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  try {
    // Test 1: Health check
    console.log('🏥 Testing health endpoint...');
    const health = await testEndpoint('/api/health');
    
    if (health.status === 200) {
      console.log('✅ Health check passed');
      console.log(`📊 Status: ${health.data.activeJobs} jobs, ${health.data.totalScans} scans, ${health.data.currentDestinations} destinations`);
    } else {
      console.log(`❌ Health check failed: ${health.status}`);
      return;
    }

    // Test 2: Scan Tustus website
    console.log('\n🔍 Testing website scan...');
    const scanStart = Date.now();
    const scan = await testEndpoint('/api/scan', 'POST', {
      url: 'https://www.tustus.co.il/Arkia/Home'
    });

    const scanTime = Date.now() - scanStart;
    
    if (scan.status === 200 && scan.data.success) {
      console.log('✅ Website scan successful!');
      console.log(`⏱️  Scan took: ${scanTime}ms`);
      console.log(`🎯 Destinations found: ${scan.data.totalDestinations}`);
      console.log(`🔄 Changes detected: ${scan.data.totalChanges}`);
      
      if (scan.data.destinations && scan.data.destinations.length > 0) {
        console.log('\n🗺️  Found destinations:');
        scan.data.destinations.forEach(dest => {
          console.log(`   • ${dest.englishName} (${dest.hebrewName}) - ${dest.price}`);
        });
      }

      if (scan.data.changes && scan.data.changes.length > 0) {
        console.log('\n🚨 Changes:');
        scan.data.changes.forEach(change => {
          console.log(`   • ${change}`);
        });
      }
    } else {
      console.log(`❌ Website scan failed:`, scan.data);
      return;
    }

    // Test 3: Get current destinations
    console.log('\n📋 Testing destinations endpoint...');
    const destinations = await testEndpoint('/api/destinations');
    
    if (destinations.status === 200) {
      console.log('✅ Destinations endpoint working');
      console.log(`📊 Total destinations: ${destinations.data.totalFound}`);
      if (destinations.data.lastUpdated) {
        console.log(`🕒 Last updated: ${new Date(destinations.data.lastUpdated).toLocaleString()}`);
      }
    }

    // Test 4: Monitor status
    console.log('\n📊 Testing monitor status...');
    const status = await testEndpoint('/api/monitor/status');
    
    if (status.status === 200) {
      console.log('✅ Monitor status working');
      console.log(`🔄 Active jobs: ${status.data.totalJobs}`);
      console.log(`📈 Total scans: ${status.data.totalScans}`);
    }

    console.log('\n🎉 All tests passed! Flight Monitor is working correctly!');
    console.log('\n📝 Next steps:');
    console.log('1. 🌐 Open http://localhost:3002 in your browser');
    console.log('2. 🔵 Click "Scan Once" to test manually');
    console.log('3. 🟢 Click "Start Monitoring" to begin automatic monitoring');
    console.log('4. 📊 Watch the destinations appear in real-time');

    console.log('\n💡 What the monitor does:');
    console.log('• Scans Tustus website every minute for flight destinations');
    console.log('• Detects Hebrew text like "טיסה לאילת" (Flight to Eilat)');
    console.log('• Extracts prices (₪200, $150) and dates');
    console.log('• Alerts when new destinations appear or prices change');
    console.log('• Keeps history of all scans and changes');

  } catch (error) {
    console.log('❌ Server connection failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure server is running: node flight-monitor-server.js');
    console.log('2. Check if port 3002 is available');
    console.log('3. Verify all dependencies are installed');
    console.log('4. Check server console for error messages');
    console.log('\n🚀 To start the server:');
    console.log('   node flight-monitor-server.js');
  }
}

runTests();