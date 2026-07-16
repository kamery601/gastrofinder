function log(level, moduleName, message, meta) {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${moduleName}] ${message}`;
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(meta !== undefined ? `${line} ${JSON.stringify(meta)}` : line);
}

module.exports = {
  info: (moduleName, message, meta) => log('info', moduleName, message, meta),
  warn: (moduleName, message, meta) => log('warn', moduleName, message, meta),
  error: (moduleName, message, meta) => log('error', moduleName, message, meta)
};
