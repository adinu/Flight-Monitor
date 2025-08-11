// flight-monitor-server.js
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const cron = require('node-cron');
const { JSDOM } = require('jsdom');
const twilio = require('twilio');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3002;

// Twilio configuration
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const ALERT_PHONE_NUMBER = process.env.ALERT_PHONE_NUMBER;

let twilioClient = null;

// Initialize Twilio if credentials are provided
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  try {
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    console.log('✅ Twilio SMS enabled');
  } catch (error) {
    console.error('❌ Twilio initialization failed:', error.message);
  }
} else {
  console.log('⚠️  SMS notifications disabled - missing Twilio credentials');
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// SMS notification function
async function sendSMSAlert(changes, destinations) {
  console.log('⚠️  sendSMSAlert');
  if (!twilioClient || !TWILIO_PHONE_NUMBER || !ALERT_PHONE_NUMBER) {
    console.log('⚠️  SMS not sent - missing configuration');
    return false;
  }

  try {
    console.log('⚠️  before message');
    const message = formatSMSMessage(changes, destinations);
    console.log('message', message);
    console.log("twilioClient",twilioClient);
    console.log("TWILIO_PHONE_NUMBER",TWILIO_PHONE_NUMBER);
    console.log("ALERT_PHONE_NUMBER", ALERT_PHONE_NUMBER);
    const result = await twilioClient.messages.create({
      body: message,
      from: TWILIO_PHONE_NUMBER,
      to: ALERT_PHONE_NUMBER
    });

    console.log(`📱 SMS sent successfully: ${result.sid}`);
    return { success: true, sid: result.sid };
    
  } catch (error) {
    console.log("error",error);
    console.error('❌ SMS sending failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Format SMS message
function formatSMSMessage(changes, destinations) {
  const timestamp = new Date().toLocaleString();
  
  let message = `🛫 TUSTUS FLIGHT ALERT\n${timestamp}\n\n`;
  
  message += `CHANGES DETECTED:\n`;
  changes.forEach(change => {
    message += `• ${change}\n`;
  });
  
  message += `\nCURRENT DESTINATIONS (${destinations.length}):\n`;
  destinations.slice(0, 5).forEach(dest => {
    message += `✈️ ${dest.englishName} - ${dest.price}\n`;
  });
  
  if (destinations.length > 5) {
    message += `... and ${destinations.length - 5} more\n`;
  }
  
  message += `\nView details: https://www.tustus.co.il/Arkia/Home`;
  
  return message;
}

// Hebrew to English destination mapping
const destinationMap = {
    'אילת': 'Eilat',
    'כרתים': 'Crete', 
    'אתונה': 'Athens',
    'רודוס': 'Rhodes',
    'סלוניקי': 'Thessaloniki',
    'לרנקה': 'Larnaca',
    'בודפשט': 'Budapest',
    'פראג': 'Prague',
    'ברלין': 'Berlin',
    'רומא': 'Rome',
    'מילאנו': 'Milan',
    'ברצלונה': 'Barcelona',
    'מדריד': 'Madrid',
    'לונדון': 'London',
    'פריז': 'Paris',
    'אמסטרדם': 'Amsterdam',
    'ניו יורק': 'New York',
    'לוס אנג\'לס': 'Los Angeles',
    'מיאמי': 'Miami',
    'טורונטו': 'Toronto',
    'קלמטה': 'Kalamata',
    'מיקונוס': 'Mykonos',
    'זנזיבר': 'Zanzibar',
    'קורפו': 'Corfu',
    'פרבזה': 'Preveza',
    'טיראנה': 'Tirana',
    'בטומי': 'Batumi',
    'טביליסי': 'Tbilisi',
    'חלקידיקי': 'Halkidiki',
    'לפקדה': 'Lefkada',
    'קוס': 'Kos',
    'בודווה': 'Budva',
    'טיווט': 'Tivat',
    'קוטור': 'Kotor',
    'בלגרד': 'Belgrade',
    'סרי לנקה-קולומבו': 'Colombo',
    'איה נאפה': 'Ayia Napa',
    'לימסול': 'Limassol',
    'זאדאר': 'Zadar',
    'טרוגיר': 'Trogir',
    'ספליט': 'Split'
};

// Store monitoring data
const monitoringJobs = new Map();
const scanHistory = [];
let lastDestinations = [];
const smsHistory = [];

// Helper function to add scan results
const addScanResult = (url, destinations, changes, smsResult = null) => {
  const result = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    url,
    destinations,
    changes,
    totalDestinations: destinations.length,
    totalChanges: changes.length,
    smsResult
  };
  
  scanHistory.unshift(result);
  
  // Keep only last 200 results
  if (scanHistory.length > 200) {
    scanHistory.pop();
  }
  
  console.log(`[${result.timestamp}] Scanned ${url}: Found ${destinations.length} destinations, ${changes.length} changes`);
  
  // Log destinations
  if (destinations.length > 0) {
    console.log('Destinations:', destinations.map(d => `${d.englishName} (${d.price})`).join(', '));
  }
  
  // Log changes
  if (changes.length > 0) {
    console.log('Changes:', changes.join(', '));
    
    // Send SMS if changes detected
    if (changes.length > 0) {
      sendSMSAlert(changes, destinations).then(smsResult => {
        if (smsResult.success) {
          smsHistory.unshift({
            timestamp: new Date().toISOString(),
            changes,
            sid: smsResult.sid,
            phone: ALERT_PHONE_NUMBER
          });
          
          // Keep only last 50 SMS records
          if (smsHistory.length > 50) {
            smsHistory.pop();
          }
        }
      });
    }
  }
  
  return result;
};

// Extract destinations from HTML
function extractDestinations(html, baseUrl) {
  const destinations = [];
  
  // Look for Hebrew destination patterns
  const hebrewDestinations = Object.keys(destinationMap);
  
  hebrewDestinations.forEach(hebrew => {
    // Look for patterns like "טיסה ל" + destination
    const flightPattern = new RegExp(`טיסה ל${hebrew}`, 'g');
    const matches = html.match(flightPattern);
    
    if (matches && matches.length > 0) {
      // Try to extract price information around this destination
      const contextPattern = new RegExp(`טיסה ל${hebrew}[\\s\\S]{0,200}?([₪$€]\\d+)`, 'g');
      const priceMatch = contextPattern.exec(html);
      
      // Try to extract date information
      const datePattern = new RegExp(`טיסה ל${hebrew}[\\s\\S]{0,200}?יום [א-ת]' (\\d{2}\\/\\d{2})`, 'g');
      const dateMatch = datePattern.exec(html);
      
      // Try to extract return date
      const returnDatePattern = new RegExp(`טיסה ל${hebrew}[\\s\\S]{0,200}?יום [א-ת]' \\d{2}\\/\\d{2} - יום [א-ת]' (\\d{2}\\/\\d{2})`, 'g');
      const returnDateMatch = returnDatePattern.exec(html);
      
      destinations.push({
        hebrewName: hebrew,
        englishName: destinationMap[hebrew],
        price: priceMatch ? priceMatch[1] : 'N/A',
        departureDate: dateMatch ? dateMatch[1] : 'N/A',
        returnDate: returnDateMatch ? returnDateMatch[1] : 'N/A',
        occurrences: matches.length,
        found: true
      });
    }
  });

  // Also look for any flight-related URLs or links
  const linkPattern = /<a[^>]*href=["']([^"']*(?:flight|טיסה|destination)[^"']*)["'][^>]*>(.*?)<\/a>/gi;
  let linkMatch;
  while ((linkMatch = linkPattern.exec(html)) !== null) {
    const href = linkMatch[1];
    const linkText = linkMatch[2];
    
    // Check if this contains destination info
    hebrewDestinations.forEach(hebrew => {
      if (linkText.includes(hebrew) && !destinations.find(d => d.hebrewName === hebrew)) {
        destinations.push({
          hebrewName: hebrew,
          englishName: destinationMap[hebrew],
          price: 'N/A',
          departureDate: 'N/A',
          returnDate: 'N/A',
          occurrences: 1,
          found: true,
          source: 'link'
        });
      }
    });
  }

  // Look for Cloudinary image URLs that might indicate destinations
  const imagePattern = /res\.cloudinary\.com\/arkia\/image\/upload\/ARKIA_Destinations\/[^"'>\s]+/g;
  const imageMatches = html.match(imagePattern);
  
  if (imageMatches) {
    console.log(`Found ${imageMatches.length} destination images`);
  }

  return destinations;
}

// Detect changes between scans
function detectChanges(newDestinations) {
  const changes = [];
  
  const newNames = newDestinations.map(d => d.englishName);
  const oldNames = lastDestinations.map(d => d.englishName);
  
  // Find added destinations
  const added = newNames.filter(name => !oldNames.includes(name));
  added.forEach(name => {
    changes.push(`+ Added: ${name}`);
  });
  
  // Find removed destinations
  const removed = oldNames.filter(name => !newNames.includes(name));
  removed.forEach(name => {
    changes.push(`- Removed: ${name}`);
  });
  
  // Find price changes
  newDestinations.forEach(newDest => {
    const oldDest = lastDestinations.find(d => d.englishName === newDest.englishName);
    if (oldDest && oldDest.price !== newDest.price && newDest.price !== 'N/A' && oldDest.price !== 'N/A') {
      changes.push(`💰 ${newDest.englishName}: ${oldDest.price} → ${newDest.price}`);
    }
  });
  
  return changes;
}

// Scan website for destinations
async function scanWebsite(url) {
  try {
    console.log(`Scanning ${url} for flight destinations...`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 15000
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const destinations = extractDestinations(html, url);
    const changes = detectChanges(destinations);

    const result = addScanResult(url, destinations, changes);
    
    // Update last destinations for next comparison
    lastDestinations = destinations;

    return result;

  } catch (error) {
    console.error(`Scan failed for ${url}:`, error.message);
    
    const errorResult = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      url,
      destinations: [],
      changes: [],
      error: error.message,
      totalDestinations: 0,
      totalChanges: 0
    };
    
    scanHistory.unshift(errorResult);
    return errorResult;
  }
}

// API Routes

// Scan website once
app.post('/api/scan', async (req, res) => {
  const { url = 'https://www.tustus.co.il/Arkia/Home' } = req.body;

  try {
    const result = await scanWebsite(url);
    res.json({
      success: !result.error,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      url
    });
  }
});

// Start monitoring
app.post('/api/monitor/start', async (req, res) => {
  const { url = 'https://www.tustus.co.il/Arkia/Home', intervalMinutes = 1 } = req.body;

  const jobId = `monitor-${url}`;

  // Stop existing job if any
  if (monitoringJobs.has(jobId)) {
    monitoringJobs.get(jobId).task.destroy();
  }

  console.log(`Starting monitoring for ${url} every ${intervalMinutes} minute(s)`);

  // Perform initial scan
  const initialResult = await scanWebsite(url);

  // Schedule recurring scans
  const cronExpression = `*/${intervalMinutes} * * * *`;
  const task = cron.schedule(cronExpression, async () => {
    await scanWebsite(url);
  }, {
    scheduled: true
  });

  monitoringJobs.set(jobId, {
    task,
    url,
    intervalMinutes,
    startTime: new Date().toISOString()
  });

  res.json({
    success: true,
    jobId,
    message: `Monitoring started for ${url}`,
    intervalMinutes,
    initialResult
  });
});

// Stop monitoring
app.post('/api/monitor/stop', (req, res) => {
  const { url = 'https://www.tustus.co.il/Arkia/Home' } = req.body;
  const jobId = `monitor-${url}`;

  if (monitoringJobs.has(jobId)) {
    monitoringJobs.get(jobId).task.destroy();
    monitoringJobs.delete(jobId);
    console.log(`Stopped monitoring ${url}`);
    res.json({ success: true, message: 'Monitoring stopped' });
  } else {
    res.status(404).json({ error: 'No active monitoring job found' });
  }
});

// Get monitoring status
app.get('/api/monitor/status', (req, res) => {
  const activeJobs = Array.from(monitoringJobs.entries()).map(([jobId, job]) => ({
    jobId,
    url: job.url,
    intervalMinutes: job.intervalMinutes,
    startTime: job.startTime
  }));

  res.json({
    activeJobs,
    totalJobs: activeJobs.length,
    totalScans: scanHistory.length
  });
});

// Get scan history
app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({
    history: scanHistory.slice(0, limit),
    total: scanHistory.length
  });
});

// Get current destinations
app.get('/api/destinations', (req, res) => {
  const latest = scanHistory.length > 0 ? scanHistory[0] : null;
  
  res.json({
    destinations: latest ? latest.destinations : [],
    lastUpdated: latest ? latest.timestamp : null,
    totalFound: latest ? latest.totalDestinations : 0
  });
});

// Get changes
app.get('/api/changes', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const changesHistory = scanHistory
    .filter(scan => scan.totalChanges > 0)
    .slice(0, limit);
  
  res.json({
    changes: changesHistory,
    total: changesHistory.length
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeJobs: monitoringJobs.size,
    totalScans: scanHistory.length,
    currentDestinations: lastDestinations.length,
    smsConfigured: !!twilioClient,
    totalSMSSent: smsHistory.length
  });
});

// Test SMS endpoint
app.post('/api/sms/test', async (req, res) => {
  console.log('starting');
  const { phoneNumber, message } = req.body;
  
  if (!twilioClient) {
    return res.status(400).json({ 
      error: 'SMS not configured - missing Twilio credentials' 
    });
  }

  const testPhone = phoneNumber || ALERT_PHONE_NUMBER;
  const testMessage = message || `🧪 Test SMS from Flight Monitor\n${new Date().toLocaleString()}\n\nSMS alerts are working correctly!`;
  console.log('testPhone', testPhone);
  console.log("testMessage",testMessage);
  console.log("TWILIO_PHONE_NUMBER",TWILIO_PHONE_NUMBER);
  console.log("twilioClient", twilioClient);
  try {
    const result = await twilioClient.messages.create({
      body: testMessage,
      from: TWILIO_PHONE_NUMBER,
      to: testPhone
    });

    res.json({ 
      success: true, 
      sid: result.sid, 
      message: 'Test SMS sent successfully' 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get SMS history
app.get('/api/sms/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json({
    smsHistory: smsHistory.slice(0, limit),
    total: smsHistory.length,
    configured: !!twilioClient,
    alertPhone: ALERT_PHONE_NUMBER
  });
});

// SMS configuration status
app.get('/api/sms/status', (req, res) => {
  res.json({
    configured: !!twilioClient,
    hasAccountSid: !!TWILIO_ACCOUNT_SID,
    hasAuthToken: !!TWILIO_AUTH_TOKEN,
    hasFromNumber: !!TWILIO_PHONE_NUMBER,
    hasAlertNumber: !!ALERT_PHONE_NUMBER,
    totalSMSSent: smsHistory.length
  });
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/flight-monitor.html');
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error', message: error.message });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  
  for (const [jobId, job] of monitoringJobs.entries()) {
    job.task.destroy();
  }
  
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Flight Monitor Server running on http://localhost:${PORT}`);
  console.log('API endpoints:');
  console.log(`  POST /api/scan - Scan website once`);
  console.log(`  POST /api/monitor/start - Start monitoring`);
  console.log(`  GET  /api/destinations - Get current destinations`);
  console.log(`  GET  /api/changes - Get change history`);
  console.log('');
  console.log('Ready to monitor Tustus flight destinations!');
});

module.exports = app;
