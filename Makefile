test:
		@node node_modules/lab/bin/lab -e development -t 90 -m 5000
test-cov:
		@node node_modules/lab/bin/lab -t 90 -e development -v ${testid} -m 5000
test-cov-html:
		@node node_modules/lab/bin/lab -c -r html -e development -o coverage.html -m 5000
test-bamboo:
		@node node_modules/lab/bin/lab -r junit -e development -o coverage-junit-report.xml -m 5000
test-cov-bamboo:
		@node node_modules/lab/bin/lab -c -r clover -e development -o coverage-clover-report.xml -m 5000
test-code-style:
		@node node_modules/jscs/bin/jscs -c .jscsrc ./
test-code-style-bamboo:
		@node node_modules/jscs/bin/jscs -c .jscsrc -r junit ./ > coverage-code-style-report.xml
jshint:
		@jshint --exclude node_modules/ .
jshint-bamboo:
		@jshint --exclude node_modules/ --reporter=./node_modules/jshint-junit-reporter/reporter.js . > coverage-jshint-report.xml


.PHONY: test test-cov test-cov-html test-bamboo test-cov-bamboo jshint jshint-bamboo test-code-style test-code-style-bamboo
