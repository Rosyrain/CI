default: build


# You must modify it to yourself information
AUTHOR=rosyrain
REPOSITORY=issue-no-pull_request
DESCRIPTION=When an issue is closed, if there is no associated pull_request, the labels are automatically added and assigned to the specified member.
ICON=arrow-up
COLOR=blue


.PHONY: build
build:
	@CGO_ENABLED=0 go build -o action .


.PHONY: clean
clean:
	@rm -rf action action.yaml


.PHONY: preconfig
preconfig:
	@./config.sh "$(AUTHOR)" "$(REPOSITORY)";


ACRION_GOLDFLAGS=-ldflags="-X 'main.Name=$(REPOSITORY)' -X 'main.Author=$(AUTHOR)' -X 'main.Description=$(DESCRIPTION)' -X 'main.Icon=$(ICON)' -X 'main.Color=$(COLOR)'"
.PHONY: action
action:
	@CGO_ENABLED=0 go run $(ACRION_GOLDFLAGS) ./optools/action