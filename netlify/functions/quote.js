const https = require('https');

function jsonRequest(options, body) {
  return new Promise(function(resolve, reject) {
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if(body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function binaryRequest(options, buffer) {
  return new Promise(function(resolve, reject) {
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

async function getDropboxToken(appKey, appSecret, refreshToken) {
  var res = await jsonRequest({
    hostname: 'api.dropboxapi.com',
    path: '/oauth2/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(appKey + ':' + appSecret).toString('base64')
    }
  }, 'grant_type=refresh_token&refresh_token=' + refreshToken);
  if(!res.body.access_token) throw new Error('Failed to get Dropbox access token: ' + JSON.stringify(res.body));
  return res.body.access_token;
}

async function uploadDropbox(fileBuffer, fileName, appKey, appSecret, refreshToken) {
  var token = await getDropboxToken(appKey, appSecret, refreshToken);
  var ts = new Date().toISOString().replace(/[:.]/g, '-');
  var safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  var path = '/3D-Print-Quotes/' + ts + '_' + safeName;

  var upRes = await binaryRequest({
    hostname: 'content.dropboxapi.com',
    path: '/2/files/upload',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Dropbox-API-Arg': JSON.stringify({ path: path, mode: 'add', autorename: true }),
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileBuffer.length
    }
  }, fileBuffer);

  if(upRes.status !== 200) throw new Error('Dropbox upload failed: ' + upRes.status);

  var linkRes = await jsonRequest({
    hostname: 'api.dropboxapi.com',
    path: '/2/sharing/create_shared_link_with_settings',
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  }, { path: path, settings: { requested_visibility: 'public' } });

  if(linkRes.status === 200) return linkRes.body.url.replace('?dl=0', '?dl=1');

  var existRes = await jsonRequest({
    hostname: 'api.dropboxapi.com',
    path: '/2/sharing/list_shared_links',
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  }, { path: path, direct_only: true });

  if(existRes.body.links && existRes.body.links[0]) {
    return existRes.body.links[0].url.replace('?dl=0', '?dl=1');
  }
  throw new Error('Could not get Dropbox link');
}

async function sendOwnerEmail(quote, fileLink, resendKey, ownerEmail) {
  var html =
    '<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto">' +
    '<h2 style="font-size:20px;margin-bottom:16px">New 3D Print Quote Request</h2>' +
    '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600;width:140px">Customer</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + quote.firstName + ' ' + quote.lastName + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Email</td><td style="padding:8px 12px;border-bottom:1px solid #eee"><a href="mailto:' + quote.email + '">' + quote.email + '</a></td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">File</td><td style="padding:8px 12px;border-bottom:1px solid #eee"><a href="' + fileLink + '">' + quote.fileName + ' (click to download)</a></td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Material</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + quote.material + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Quality</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + quote.quality + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Infill</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + quote.infill + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Colors</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + (quote.colors || 'None') + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Finish</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + quote.finish + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Turnaround</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + quote.turnaround + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Quantity</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + quote.qty + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Weight</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + quote.weight + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Print time</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + quote.printTime + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Notes</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + (quote.notes || 'None') + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#111;color:#fff;font-weight:600">Total estimate</td><td style="padding:8px 12px;background:#111;color:#fff;font-size:18px;font-weight:600">$' + quote.total + '</td></tr>' +
    '</table>' +
    '<p style="margin-top:16px;font-size:13px;color:#666">Reply to this email or send a Shopify draft order invoice to collect payment.</p>' +
    '</div>';

  return jsonRequest({
    hostname: 'api.resend.com',
    path: '/emails',
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' }
  }, {
    from: 'quotes@highlyobtainable.com',
    to: ownerEmail,
    subject: 'New 3D Print Quote - ' + quote.firstName + ' ' + quote.lastName + ' ($' + quote.total + ')',
    html: html
  });
}

async function sendCustomerEmail(quote, resendKey, ownerEmail) {
  var html =
    '<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto">' +
    '<h2 style="font-size:20px;margin-bottom:8px">Your 3D print quote</h2>' +
    '<p style="font-size:14px;color:#666;margin-bottom:20px">Hi ' + quote.firstName + ', thanks for your quote request! Here is a summary of what you submitted. We will review your file and be in touch within 24 hours to confirm your order and send a payment link.</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600;width:140px">File</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + quote.fileName + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Material</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + quote.material + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Quality</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + quote.quality + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Infill</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + quote.infill + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Colors</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + (quote.colors || 'None') + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Finish</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + quote.finish + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Turnaround</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + quote.turnaround + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Quantity</td><td style="padding:8px 12px;border-bottom:1px solid #eee">' + quote.qty + '</td></tr>' +
    '<tr><td style="padding:8px 12px;background:#111;color:#fff;font-weight:600">Estimated total</td><td style="padding:8px 12px;background:#111;color:#fff;font-size:18px;font-weight:600">$' + quote.total + '</td></tr>' +
    '</table>' +
    '<p style="margin-top:16px;font-size:13px;color:#666">This is an estimate only. Final price will be confirmed before payment is taken. If you have any questions just reply to this email.</p>' +
    '</div>';

  return jsonRequest({
    hostname: 'api.resend.com',
    path: '/emails',
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' }
  }, {
    from: 'quotes@highlyobtainable.com',
    to: quote.email,
    reply_to: ownerEmail,
    subject: 'Your 3D print quote - $' + quote.total,
    html: html
  });
}

exports.handler = async function(event) {
  var headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if(event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }

  if(event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    var payload = JSON.parse(event.body);
    var quote = payload.quote;
    var fileBase64 = payload.file;
    var fileName = payload.fileName;

    var DROPBOX_APP_KEY       = process.env.DROPBOX_APP_KEY;
    var DROPBOX_APP_SECRET    = process.env.DROPBOX_APP_SECRET;
    var DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;
    var RESEND_KEY            = process.env.RESEND_KEY;
    var OWNER_EMAIL           = process.env.OWNER_EMAIL;

    // 1. Upload file to Dropbox
    var fileLink = null;
    if(fileBase64 && fileBase64.length > 10) {
      var fileBuffer = Buffer.from(fileBase64, 'base64');
      fileLink = await uploadDropbox(fileBuffer, fileName, DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN);
    }

    // 2. Email owner
    await sendOwnerEmail(quote, fileLink || '(no file)', RESEND_KEY, OWNER_EMAIL);

    // 3. Email customer
    await sendCustomerEmail(quote, RESEND_KEY, OWNER_EMAIL);

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({ success: true })
    };

  } catch(err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
