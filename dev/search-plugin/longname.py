#VERSION: 2.13
# AUTHORS: test

# Only for the search plugins window (views.json → searchplugins-cards), which
# installs and uninstalls it: a long name and URL, and no search results.


class longname(object):
    url = 'https://search.example.org/a/rather/long/path/to/the/search/engine'
    name = 'Example Search Engine With A Rather Long Name For Testing'
    supported_categories = {'all': '0'}

    def search(self, what, cat='all'):
        pass
