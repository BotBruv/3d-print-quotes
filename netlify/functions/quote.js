const https = require('https');

// ── helpers ──────────────────────────────────────────────────────────────────

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

// ── Dropbox ───────────────────────────────────────────────────────────────────

async function uploadDropbox(fileBuffer, fileName, token) {
  var ts = new Date().toISOString().replace(/[:.]/g, '-');
  var safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  var path = '/3D-Print-Quotes/' + ts + '_' + safeName;

  // Upload file
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

  // Create shared link
  var linkRes = await jsonRequest({
    hostname: 'api.dropboxapi.com',
    path: '/2/sharing/create_shared_link_with_settings',
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  }, { path: path, settings: { requested_visibility: 'public' } });

  if(linkRes.status === 200) return linkRes.body.url.replace('?dl=0', '?dl=1');

  // Link may already exist — fetch it
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

// ── Shopify ───────────────────────────────────────────────────────────────────

async function createDraftOrder(quote, fileLink, shopDomain, accessToken) {
  var note = [
    'File: ' + quote.fileName,
    'Dropbox: ' + fileLink,
    'Material: ' + quote.material,
    'Quality: ' + quote.quality,
    'Infill: ' + quote.infill,
    'Colors: ' + (quote.colors || 'None'),
    'Finish: ' + quote.finish,
    'Turnaround: ' + quote.turnaround,
    'Notes: ' + (quote.notes || 'None')
  ].join('\n');

  var body = {
    draft_order: {
      line_items: [{
        title: 'Custom 3D Print',
        price: quote.unitPrice.toFixed(2),
        quantity: parseInt(quote.qty) || 1,
        requires_shipping: true
      }],
      customer: { email: quote.email },
      shipping_address: { first_name: quote.firstName, last_name: quote.lastName },
      note: note,
      send_invoice: true,
      invoice_message: 'Hi ' + quote.firstName + ',\n\nThank you for your 3D print quote request! Your order total is $' + quote.total + '.\n\nPlease click the link below to complete your payment and we will get started on your print.\n\nIf you have any questions just reply to this email.\n\nThanks!'
    }
  };

  var res = await jsonRequest({
    hostname: shopDomain,
    path: '/admin/api/2024-01/draft_orders.json',
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    }
  }, body);

  if(res.status !== 201) throw new Error('Shopify draft order failed: ' + JSON.stringify(res.body));
  return res.body.draft_order;
}

// ── Resend email ──────────────────────────────────────────────────────────────

async function sendOwnerEmail(quote, fileLink, draftOrder, resendKey, ownerEmail) {
  var invoiceUrl = draftOrder.invoice_url || '(see Shopify admin)';
  var html = '<h2>New 3D Print Quote</h2>' +
    '<table style="border-collapse:collapse;width:100%;font-family:system-ui,sans-serif;font-size:14px">' +
    '<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600">Customer</td><td style="padding:6px 12px">' + quote.firstName + ' ' + quote.lastName + ' (' + quote.email + ')</td></tr>' +
    '<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600">File</td><td style="padding:6px 12px"><a href="' + fileLink + '">' + quote.fileName + '</a></td></tr>' +
    '<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600">Material</td><td style="padding:6px 12px">' + quote.material + '</td></tr>' +
    '<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600">Quality</td><td style="padding:6px 12px">' + quote.quality + '</td></tr>' +
    '<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600">Infill</td><td style="padding:6px 12px">' + quote.infill + '</td></tr>' +
    '<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600">Colors</td><td style="padding:6px 12px">' + (quote.colors || 'None') + '</td></tr>' +
    '<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600">Finish</td><td style="padding:6px 12px">' + quote.finish + '</td></tr>' +
    '<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600">Turnaround</td><td style="padding:6px 12px">' + quote.turnaround + '</td></tr>' +
    '<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600">Quantity</td><td style="padding:6px 12px">' + quote.qty + '</td></tr>' +
    '<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600">Weight</td><td style="padding:6px 12px">' + quote.weight + '</td></tr>' +
    '<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600">Print time</td><td style="padding:6px 12px">' + quote.printTime + '</td></tr>' +
    '<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600">Total</td><td style="padding:6px 12px;font-weight:600;font-size:16px">$' + quote.total + '</td></tr>' +
    '<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600">Notes</td><td style="padding:6px 12px">' + (quote.notes || 'None') + '</td></tr>' +
    '<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600">Invoice sent to customer</td><td style="padding:6px 12px"><a href="' + invoiceUrl + '">View in Shopify</a></td></tr>' +
    '</table>';

  await jsonRequest({
    hostname: 'api.resend.com',
    path: '/emails',
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' }
  }, {
    from: 'quotes@' + ownerEmail.split('@')[1],
    to: ownerEmail,
    subject: 'New 3D Print Quote - ' + quote.firstName + ' ' + quote.lastName + ' ($' + quote.total + ')',
    html: html
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────

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

    // Env vars (set in Netlify dashboard)
    var DROPBOX_TOKEN  = process.env.DROPBOX_TOKEN;
    var SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;   // e.g. kingss-sshop.myshopify.com
    var SHOPIFY_TOKEN  = process.env.SHOPIFY_TOKEN;    // Admin API access token
    var RESEND_KEY     = process.env.RESEND_KEY;
    var OWNER_EMAIL    = process.env.OWNER_EMAIL;

    // 1. Upload to Dropbox
    var fileBuffer = Buffer.from(fileBase64, 'base64');
    var fileLink = await uploadDropbox(fileBuffer, fileName, DROPBOX_TOKEN);

    // 2. Create Shopify draft order (sends invoice to customer automatically)
    var draftOrder = await createDraftOrder(quote, fileLink, SHOPIFY_DOMAIN, SHOPIFY_TOKEN);

    // 3. Email owner
    await sendOwnerEmail(quote, fileLink, draftOrder, RESEND_KEY, OWNER_EMAIL);

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({ success: true, invoiceUrl: draftOrder.invoice_url })
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
