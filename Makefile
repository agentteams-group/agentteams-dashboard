# ============================================================
# agentteams-dashboard Makefile
# ============================================================
# Build, test, and push the agentteams-dashboard Docker image.
#
# Usage:
#   make build              # Build native-arch image locally
#   make push               # Build + push multi-arch image (amd64 + arm64)
#   make push-native        # Push native-arch image only (dev use)
#   make help               # Show this help
# ============================================================

# ---------- Configuration ----------

VERSION  ?= latest
REGISTRY ?= higress-registry.cn-hangzhou.cr.aliyuncs.com
REPO     ?= agentteams

IMAGE     ?= $(REGISTRY)/$(REPO)/agentteams-dashboard
IMAGE_TAG ?= $(IMAGE):$(VERSION)

LOCAL_IMAGE = agentteams-dashboard:$(VERSION)

# Multi-arch configuration
MULTIARCH_PLATFORMS ?= linux/amd64,linux/arm64
BUILDX_BUILDER      ?= agentteams-multiarch

# Pre-release detection: -rc/-beta/-alpha should NOT push :latest
IS_PRERELEASE := $(shell echo "$(VERSION)" | grep -qiE -- '-(rc|beta|alpha|pre|preview|dev|snapshot)(\.[0-9]+)?$$' && echo 1 || echo 0)
PUSH_LATEST   := $(if $(filter latest,$(VERSION)),,$(if $(filter 1,$(IS_PRERELEASE)),,yes))

# Extra build args
DOCKER_BUILD_ARGS ?=
DOCKER_PLATFORM   ?=
ifdef DOCKER_PLATFORM
  PLATFORM_FLAG = --platform $(DOCKER_PLATFORM)
else
  PLATFORM_FLAG =
endif

# ---------- Phony targets ----------

.PHONY: all build tag push push-native buildx-setup clean help

# ---------- Default ----------

all: build

# ---------- Build ----------

build: ## Build native-arch Docker image locally
	@echo "==> Building agentteams-dashboard: $(LOCAL_IMAGE)"
	docker build $(PLATFORM_FLAG) $(DOCKER_BUILD_ARGS) \
		-t $(LOCAL_IMAGE) \
		.

# ---------- Tag ----------

tag: build ## Tag local image for registry push
	docker tag $(LOCAL_IMAGE) $(IMAGE_TAG)
ifeq ($(PUSH_LATEST),yes)
	docker tag $(LOCAL_IMAGE) $(IMAGE):latest
	@echo "==> Image tagged as $(VERSION) and latest"
else
	@echo "==> Image tagged as $(VERSION) (latest not pushed for pre-release)"
endif

# ---------- Runtime detection ----------

IS_PODMAN := $(shell docker version 2>&1 | grep -qi podman && echo 1 || echo 0)

buildx-setup: ## Ensure multi-arch build prerequisites are met
ifeq ($(IS_PODMAN),1)
	@echo "==> Podman detected — using manifest workflow"
else
	@if ! docker buildx inspect $(BUILDX_BUILDER) >/dev/null 2>&1; then \
		echo "==> Creating buildx builder: $(BUILDX_BUILDER)"; \
		docker buildx create --name $(BUILDX_BUILDER) --driver docker-container --bootstrap; \
	else \
		echo "==> Buildx builder $(BUILDX_BUILDER) already exists"; \
	fi
endif

# ---------- Push (multi-arch, default) ----------

push: buildx-setup ## Build + push multi-arch image (amd64 + arm64)
	@echo "==> Building + pushing multi-arch agentteams-dashboard: $(IMAGE_TAG) [$(MULTIARCH_PLATFORMS)]"
ifeq ($(IS_PODMAN),1)
	-podman manifest rm $(IMAGE_TAG) 2>/dev/null
	@# use comma as separator workaround for foreach
	@IFS=',' ; for plat in $(MULTIARCH_PLATFORMS); do \
		echo "  -> Building agentteams-dashboard for $$plat..."; \
		podman build --platform $$plat \
			$(DOCKER_BUILD_ARGS) \
			--manifest $(IMAGE_TAG) \
			. ; \
	done
	podman manifest push --all $(IMAGE_TAG) docker://$(IMAGE_TAG)
	$(if $(PUSH_LATEST), \
		podman manifest push --all $(IMAGE_TAG) docker://$(IMAGE):latest && \
		echo "  -> Also pushed :latest tag")
else
	docker buildx build \
		--builder $(BUILDX_BUILDER) \
		--platform $(MULTIARCH_PLATFORMS) \
		$(DOCKER_BUILD_ARGS) \
		-t $(IMAGE_TAG) \
		$(if $(PUSH_LATEST),-t $(IMAGE):latest) \
		--push \
		.
endif

# ---------- Push native-arch only (dev use) ----------

push-native: tag ## Push native-arch image only (dev, overwrites multi-arch!)
	@echo "WARNING: Pushing native-arch only — this overwrites multi-arch manifests!"
	@echo "==> Pushing agentteams-dashboard: $(IMAGE_TAG)"
	docker push $(IMAGE_TAG)
ifeq ($(PUSH_LATEST),yes)
	docker push $(IMAGE):latest
endif

# ---------- Clean ----------

clean: ## Remove local Docker image
	docker rmi $(LOCAL_IMAGE) 2>/dev/null || true
	docker rmi $(IMAGE_TAG) 2>/dev/null || true

# ---------- Help ----------

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'
