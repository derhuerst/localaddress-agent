import {createServer, get as httpGet} from 'http'
import {createIpPoolAgent} from './index.js'

// HTTP server we'll do requests against
const server = createServer((req, res) => {
	console.log('server', 'req from', req.socket.remoteAddress, req.socket.remotePort)
	res.end()
})

// endlessly generate random IPv6 addresses
const ipAddresses = (function* () {
	while (true) {
		yield [
			'fe80::dead:beef::',
			Math.random().toString(16).slice(2, 6), ':',
			Math.random().toString(16).slice(2, 6),
			'/64',
		].join('')
	}
})()

;(async () => {
	const agent = await createIpPoolAgent(ipAddresses, 'eth0')

	const fetchSelf = (port) => new Promise((resolve, reject) => {
		const req = httpGet('http://[::1]:' + port, {
			agent,
		}, (res) => {
			res.once('error', reject)
			res.on('data', () => {})
			res.once('end', resolve)
		})
		req.once('error', reject)
	})

	const port = await new Promise((resolve, reject) => {
		server.listen((err) => {
			if (err) reject(err)
			else resolve(server.address().port)
		})
	})

	// 10 requests in parallel, 10 times
	for (let i = 0; i < 10; i++) {
		await Promise.all(new Array(10).fill(null).map(_ => fetchSelf(port)))
	}

	server.close()
	agent.destroy()
})()
