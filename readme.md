# ip-range-localaddress-agent

**[Node.js HTTP Agent](https://nodejs.org/api/http.html#class-httpagent) to use IP addresses from a range for outgoing requests.** Currently Linux only!

[![npm version](https://img.shields.io/npm/v/ip-range-localaddress-agent.svg)](https://www.npmjs.com/package/ip-range-localaddress-agent)
![ISC-licensed](https://img.shields.io/github/license/derhuerst/ip-range-localaddress-agent.svg)
![minimum Node.js version](https://img.shields.io/node/v/ip-range-localaddress-agent.svg)
[![support me via GitHub Sponsors](https://img.shields.io/badge/support%20me-donate-fa7664.svg)](https://github.com/sponsors/derhuerst)
[![chat with me on Twitter](https://img.shields.io/badge/chat%20with%20me-on%20Twitter-1da1f2.svg)](https://twitter.com/derhuerst)

Do you have a large number of IP addresses (e.g. a `/64` IPv6 range assigned to your [VPS](https://en.wikipedia.org/wiki/Virtual_private_server)) that you would like to use for outgoing requests? Assigning *all* of them to your network interface *up front* is not viable, as there are just too many; Assigning them in batches periodically is a bit unreliable as well, as you will have to coordinate the switch from one batch to another.

This package on the other hand

1. lets you specify a range (or an [iterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols), if you want more control) of IP addresses,
2. always keeps a configurable number of IP addresses assigned to the network interface,
3. removes them once they have been used often enough (once by default).

To assign & remove addresses from the network interfaces efficiently, this package uses the [rtnetlink API](https://www.man7.org/linux/man-pages/man7/rtnetlink.7.html) via the [awesome `netlink`](https://github.com/mildsunrise/node_netlink) npm package.


## Installation

```shell
npm install ip-range-localaddress-agent
```


## Usage

```js
todo
```


## Contributing

If you have a question or need support using `ip-range-localaddress-agent`, please double-check your code and setup first. If you think you have found a bug or want to propose a feature, use [the issues page](https://github.com/derhuerst/ip-range-localaddress-agent/issues).
