import Base
import ./main.bend as R

# LAW (attempt 2): for every template fetcher, the report is what it answers
law report_from_fetcher:
  for fetch: Unit -> String
  {R.loadReport(fetch) == fetch(Unit{}) : String}
