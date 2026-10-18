# Agreed modernization scope

The user selected: full AI platform with storefront, shopping assistant, recommendations,
and observability. Preserve the original legacy app and its Git history.

Acceptance criteria implemented: browse/search/filter/sort products; view stock and
prices; manage a persistent anonymous bag; explicitly confirm a demo order; ask a
catalogue-grounded shopping question with a budget; distinguish AI and no-model modes;
inspect health; expose request metrics and correlated traces; run automated checks.

No earlier discussion details were available. This implementation assumes a local
fictional-commerce demo, EUR prices from the source catalogue, optional model credentials,
and read-only operational assistance. Real payments, authentication and production
cloud deployment are outside the implemented local-demo scope.
