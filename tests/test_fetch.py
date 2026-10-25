import io
import socket
import unittest
from unittest.mock import patch
from urllib.error import HTTPError,URLError
from collector.fetch import Fetcher,SourceUnavailable,safe_url


class Response(io.BytesIO):
    def __init__(self,body):
        super().__init__(body);self.headers={'Content-Length':str(len(body))}


class Opener:
    def __init__(self,robots,file=b'prices'):
        self.robots=robots;self.file=file;self.calls=[]
    def open(self,request,**options):
        url=request.full_url;self.calls.append(url)
        value=self.robots if url.endswith('/robots.txt') else self.file
        if isinstance(value,BaseException):raise value
        return Response(value)


class FetchTests(unittest.TestCase):
    url='https://prices.example/current.csv'
    addresses=[(socket.AF_INET,socket.SOCK_STREAM,6,'',('93.184.216.34',443))]

    def fetch(self,opener):
        with patch('collector.fetch.socket.getaddrinfo',return_value=self.addresses), \
             patch('collector.fetch.build_opener',return_value=opener),patch('collector.fetch.time.sleep'):
            return Fetcher().read(self.url,{'prices.example'})

    def test_missing_or_unsupported_robots_does_not_block_a_public_file(self):
        for code in [400,404,410]:
            with self.subTest(code=code):
                opener=Opener(HTTPError('https://prices.example/robots.txt',code,'unavailable',{},None))
                self.assertEqual(self.fetch(opener),b'prices')
                self.assertEqual(opener.calls,['https://prices.example/robots.txt',self.url])

    def test_robots_denials_throttling_and_server_failures_do_not_fetch_the_file(self):
        for code in [401,403,429,500,503]:
            with self.subTest(code=code):
                opener=Opener(HTTPError('https://prices.example/robots.txt',code,'unavailable',{},None))
                with self.assertRaisesRegex(SourceUnavailable,'robots_unavailable'):self.fetch(opener)
                self.assertEqual(len(opener.calls),1)
        opener=Opener(URLError('unreachable'))
        with self.assertRaises(URLError):self.fetch(opener)
        self.assertEqual(len(opener.calls),1)

    def test_explicit_robots_rules_remain_binding(self):
        opener=Opener(b'User-agent: *\nDisallow: /\n')
        with self.assertRaisesRegex(SourceUnavailable,'robots_disallowed'):self.fetch(opener)
        self.assertEqual(len(opener.calls),1)

    def test_actual_price_file_auth_errors_are_never_treated_as_success(self):
        for code in [400,401,403,404,429,500]:
            with self.subTest(code=code):
                opener=Opener(HTTPError('https://prices.example/robots.txt',400,'unsupported',{},None),
                              HTTPError(self.url,code,'denied',{},None))
                with self.assertRaises(HTTPError) as error:self.fetch(opener)
                self.assertEqual(error.exception.code,code)

    def test_unapproved_hosts_and_private_addresses_are_rejected(self):
        with patch('collector.fetch.socket.getaddrinfo',return_value=self.addresses):
            with self.assertRaisesRegex(SourceUnavailable,'unapproved_url'):safe_url(self.url,{'other.example'})
        private=[(socket.AF_INET,socket.SOCK_STREAM,6,'',('127.0.0.1',443))]
        with patch('collector.fetch.socket.getaddrinfo',return_value=private):
            with self.assertRaisesRegex(SourceUnavailable,'nonpublic_host'):safe_url(self.url,{'prices.example'})
