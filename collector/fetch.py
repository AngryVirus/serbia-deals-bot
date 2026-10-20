"""Bounded HTTPS downloads restricted to reviewed publisher hosts."""
import ipaddress
import socket
import time
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser


class SourceUnavailable(RuntimeError):
    pass


def safe_url(url, hosts):
    parts = urlsplit(url)
    if parts.scheme != 'https' or parts.username or parts.password or parts.port not in (None, 443) or parts.hostname not in hosts:
        raise SourceUnavailable('unapproved_url')
    try:
        addresses = socket.getaddrinfo(parts.hostname, 443, type=socket.SOCK_STREAM)
    except OSError:
        raise SourceUnavailable('dns_unavailable') from None
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise SourceUnavailable('nonpublic_host')
    return url


class Redirects(HTTPRedirectHandler):
    def __init__(self, hosts):
        super().__init__(); self.hosts = hosts
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_url(newurl, self.hosts)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Fetcher:
    def __init__(self, *, max_bytes=32*1024*1024, deadline=None):
        self.max_bytes = max_bytes
        self.deadline = deadline or time.monotonic()+1200
        self.robots = {}; self.last = {}

    def read(self, url, hosts, *, metadata=False):
        safe_url(url, hosts)
        host = urlsplit(url).netloc
        if time.monotonic() >= self.deadline:
            raise SourceUnavailable('time_budget')
        if not metadata and host not in self.robots:
            robots_url = 'https://'+host+'/robots.txt'
            try:
                body = self._get(robots_url, hosts, 65536)
                rules = RobotFileParser(); rules.parse(body.decode(errors='replace').splitlines())
                self.robots[host] = rules
            except HTTPError as e:
                if e.code != 404:
                    raise SourceUnavailable('robots_unavailable') from None
                self.robots[host] = None
        rules = self.robots.get(host)
        if rules and not rules.can_fetch('SerbiaDealsBot', url):
            raise SourceUnavailable('robots_disallowed')
        return self._get(url, hosts, self.max_bytes)

    def _get(self, url, hosts, limit):
        host = urlsplit(url).netloc
        delay = max(0, self.last.get(host, 0)+1.5-time.monotonic())
        if time.monotonic()+delay >= self.deadline:
            raise SourceUnavailable('time_budget')
        if delay: time.sleep(delay)
        self.last[host] = time.monotonic()
        request = Request(url, headers={'User-Agent': 'SerbiaDealsBot/1.0 (official open price lists)', 'Accept-Encoding': 'identity'})
        with build_opener(Redirects(hosts)).open(request, timeout=min(25, max(1, self.deadline-time.monotonic()))) as response:
            declared = response.headers.get('Content-Length')
            if declared and int(declared) > limit:
                raise SourceUnavailable('size_budget')
            chunks, size = [], 0
            while True:
                if time.monotonic() >= self.deadline:
                    raise SourceUnavailable('time_budget')
                chunk = response.read(min(65536, limit+1-size))
                if not chunk: break
                chunks.append(chunk); size += len(chunk)
                if size > limit: raise SourceUnavailable('size_budget')
            if declared and size != int(declared):
                raise SourceUnavailable('incomplete_download')
            return b''.join(chunks)
