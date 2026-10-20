#VERSION: 1.00
# AUTHORS: test

from novaprinter import prettyPrinter


class dummytest(object):
    url = 'http://example.com'
    name = 'Dummy Test'
    supported_categories = {'all': '0', 'movies': '6', 'tv': '4'}

    def search(self, what, cat='all'):
        for i in range(30):
            prettyPrinter({
                'link': 'magnet:?xt=urn:btih:%040x' % (i + 1),
                'name': '%s result %d - Some.Long.Release.Name.2026.1080p.WEB-DL.x264' % (what, i),
                'size': str((i + 1) * 123456789),
                'seeds': str(100 - i),
                'leech': str(i),
                'engine_url': self.url,
                'desc_link': 'http://example.com/%d' % i,
                'pub_date': str(1700000000 + i * 86400),
            })
