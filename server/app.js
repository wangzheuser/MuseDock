const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

/**
 * 限制浏览器跨源请求只能来自本机页面。
 * @param {string|undefined} origin 请求 Origin。
 * @returns {boolean} 是否允许跨源访问。
 */
function isLocalCorsOrigin(origin) {
  if (!origin) return true;
  try {
    const { hostname } = new URL(origin);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

app.use(cors({
  origin(origin, callback) {
    if (isLocalCorsOrigin(origin)) return callback(null, true);
    return callback(new Error('当前只允许本机页面访问 API。'));
  },
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../frontend-dist')));
app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/api/config', require('./routes/config'));
app.use('/api/creative-workflows', require('./routes/creativeWorkflows'));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(__dirname, '../frontend-dist/index.html'));
});

module.exports = app;
