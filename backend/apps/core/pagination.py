from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    """Pages of 10, 20 or 50 rows (?page=2&page_size=20)."""

    page_size = 10
    page_size_query_param = "page_size"
    max_page_size = 50
