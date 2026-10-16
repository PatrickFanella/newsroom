// SMTP sink for the isolated deployment smoke test. Never used by production.
import net from 'node:net';
import http from 'node:http';
let message = '';
net.createServer(socket => {
  socket.setEncoding('utf8');
  socket.write('220 fixture ESMTP\r\n');
  let buffer = '', data = false, lines = [];
  socket.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\r\n')) {
      const end = buffer.indexOf('\r\n');
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (data) {
        if (line === '.') { message = lines.join('\n'); lines = []; data = false; socket.write('250 received\r\n'); }
        else lines.push(line);
      } else if (/^(EHLO|HELO)/.test(line)) socket.write('250 fixture\r\n');
      else if (line === 'DATA') { data = true; socket.write('354 send data\r\n'); }
      else if (line === 'QUIT') { socket.end('221 bye\r\n'); }
      else socket.write('250 ok\r\n');
    }
  });
}).listen(1025, '0.0.0.0');
http.createServer((req, res) => { res.end(message); }).listen(8080, '0.0.0.0');
