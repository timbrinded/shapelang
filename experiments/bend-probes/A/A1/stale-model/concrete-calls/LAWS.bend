import Base
import ./main.bend as R

# LAW (attempt 1): the report is the remote template
law report_is_template:
  {R.loadReport() == R.template() : String}
