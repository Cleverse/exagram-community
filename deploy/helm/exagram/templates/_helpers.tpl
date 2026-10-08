{{/* Names: every resource is prefixed with the fullname, so two releases in one namespace don't collide. */}}
{{- define "exagram.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "exagram.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/* <fullname>-<component>, e.g. (include "exagram.componentName" (list . "api")). */}}
{{- define "exagram.componentName" -}}
{{- $ctx := index . 0 }}
{{- $component := index . 1 }}
{{- printf "%s-%s" (include "exagram.fullname" $ctx | trunc (int (sub 62 (len $component))) | trimSuffix "-") $component }}
{{- end }}

{{- define "exagram.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "exagram.selectorLabels" -}}
{{- $ctx := index . 0 -}}
app.kubernetes.io/name: {{ include "exagram.name" $ctx | quote }}
app.kubernetes.io/instance: {{ $ctx.Release.Name | quote }}
app.kubernetes.io/component: {{ index . 1 }}
{{- end }}

{{- define "exagram.labels" -}}
{{- $ctx := index . 0 -}}
helm.sh/chart: {{ include "exagram.chart" $ctx }}
{{ include "exagram.selectorLabels" . }}
app.kubernetes.io/version: {{ $ctx.Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ $ctx.Release.Service }}
app.kubernetes.io/part-of: exagram
{{- end }}

{{/* Hosts. ucHost defaults to gen-secrets.sh's rule: "-files" after appHost's first label. */}}
{{- define "exagram.appHost" -}}
{{- $host := required "appHost is required: the host people open, e.g. --set appHost=exagram.acme.com" .Values.appHost }}
{{- if not (regexMatch "^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$" $host) }}
{{- fail (printf "appHost must be a lower-case host name, without scheme, port or path: %s" $host) }}
{{- end }}
{{- $host }}
{{- end }}

{{- define "exagram.ucHost" -}}
{{- $app := include "exagram.appHost" . }}
{{- $uc := .Values.ucHost }}
{{- if not $uc }}
{{- $labels := splitList "." $app }}
{{- if lt (len $labels) 3 }}
{{- fail (printf "ucHost is required when appHost has fewer than 3 labels (%s): the default, \"-files\" after the first label, would need a host like app.example.com" $app) }}
{{- end }}
{{- $first := printf "%s-files" (first $labels) }}
{{- if gt (len $first) 63 }}
{{- fail (printf "ucHost is required: the default %s is longer than a DNS label allows" $first) }}
{{- end }}
{{- $uc = printf "%s.%s" $first (rest $labels | join ".") }}
{{- end }}
{{- if not (regexMatch "^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$" $uc) }}
{{- fail (printf "ucHost must be a lower-case host name, without scheme, port or path: %s" $uc) }}
{{- end }}
{{- if eq $uc $app }}
{{- fail "ucHost must differ from appHost: HTML bodies would run on the app's origin" }}
{{- end }}
{{- $uc }}
{{- end }}

{{/* Images: <registry>/exagram-<name>:<tag>[@<digest>]. */}}
{{- define "exagram.image" -}}
{{- $ctx := index . 0 }}
{{- $name := index . 1 }}
{{- $tag := $ctx.Values.image.tag | default $ctx.Chart.AppVersion }}
{{- $digest := index ($ctx.Values.image.digest | default dict) $name | default "" }}
{{- printf "%s/exagram-%s:%s" $ctx.Values.image.registry $name $tag }}{{ if $digest }}@{{ $digest }}{{ end }}
{{- end }}

{{- define "exagram.imagePullSecrets" -}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/* The Secret every app reads: the chart's own, or existingSecret. */}}
{{- define "exagram.secretName" -}}
{{- .Values.existingSecret | default (include "exagram.fullname" .) }}
{{- end }}

{{/* One env entry read from the Secret. (list . "KEY") or (list . "KEY" true) for an optional key. */}}
{{- define "exagram.secretEnv" -}}
{{- $ctx := index . 0 -}}
- name: {{ index . 1 }}
  valueFrom:
    secretKeyRef:
      name: {{ include "exagram.secretName" $ctx | quote }}
      key: {{ index . 1 }}
      {{- if gt (len .) 2 }}
      optional: true
      {{- end }}
{{- end }}

{{/*
Bundled Postgres: the Service name is the URL host and the one DATABASE_PLAINTEXT_HOSTS entry, since
the apps refuse plaintext unless the host matches it exactly (packages/core/repository/postgres/db-tls.ts).
*/}}
{{- define "exagram.postgresHost" -}}
{{- include "exagram.componentName" (list . "postgres") }}
{{- end }}

{{/* Same shapes as gen-secrets.sh writes for the bundled database. Takes (list . password). */}}
{{- define "exagram.bundledDatabaseUrl" -}}
{{- $ctx := index . 0 }}
{{- print "postgres://exagram:" (index . 1) "@" (include "exagram.postgresHost" $ctx) ":5432/exagram?sslmode=disable&search_path=exagram%2Cpublic" }}
{{- end }}

{{- define "exagram.bundledMigrateDatabaseUrl" -}}
{{- $ctx := index . 0 }}
{{- print "postgres://exagram:" (index . 1) "@" (include "exagram.postgresHost" $ctx) ":5432/exagram?sslmode=disable&x-migrations-table-quoted=1&x-migrations-table=%22public%22.%22schema_migrations%22" }}
{{- end }}

{{- define "exagram.databasePlaintextHosts" -}}
{{- if .Values.database.bundled }}
{{- include "exagram.postgresHost" . }}
{{- else }}
{{- .Values.database.external.plaintextHosts }}
{{- end }}
{{- end }}

{{- define "exagram.dbCaMounted" -}}
{{- if and (not .Values.database.bundled) .Values.database.external.caSecret.name }}true{{ end }}
{{- end }}

{{/* Database keys every app and preflight carry, as compose.yml passes them. */}}
{{- define "exagram.databaseEnv" -}}
{{ include "exagram.secretEnv" (list . "DATABASE_URL") }}
- name: DATABASE_PLAINTEXT_HOSTS
  value: {{ include "exagram.databasePlaintextHosts" . | quote }}
- name: DATABASE_CA_SERVER_SPECIFIC
  value: {{ ternary "true" "" (and (not .Values.database.bundled) .Values.database.external.caIsServerSpecific) | quote }}
{{- end }}

{{- define "exagram.filesystem" -}}
{{- if eq .Values.storage.driver "filesystem" }}true{{ end }}
{{- end }}

{{/* RWO is per node: every Pod mounting the objects claim must share one. Dropped for ReadWriteMany. */}}
{{- define "exagram.objectsAffinity" -}}
{{- if and (include "exagram.filesystem" .) (ne .Values.persistence.objects.accessMode "ReadWriteMany") }}true{{ end }}
{{- end }}

{{/*
Storage keys, as compose.yml passes them. Takes (dict "ctx" . "app" "api"|"worker"|"usercontent"|"preflight").
S3_PUBLIC_ENDPOINT goes to api and preflight only, GCS_CREATE_ONLY_UPLOADS to api only.
*/}}
{{- define "exagram.storageEnv" -}}
{{- $ctx := .ctx }}
{{- $s3 := eq $ctx.Values.storage.driver "s3" }}
{{- $gcs := eq $ctx.Values.storage.driver "gcs" }}
{{- $s3v := $ctx.Values.storage.s3 }}
{{- $gcsv := $ctx.Values.storage.gcs }}
- name: STORAGE_DRIVER
  value: {{ $ctx.Values.storage.driver | quote }}
- name: STORAGE_DIR
  value: /var/lib/exagram/objects
- name: S3_ENDPOINT
  value: {{ ternary $s3v.endpoint "" $s3 | quote }}
{{- if has .app (list "api" "preflight") }}
- name: S3_PUBLIC_ENDPOINT
  value: {{ ternary $s3v.publicEndpoint "" $s3 | quote }}
{{- end }}
- name: S3_REGION
  value: {{ ternary $s3v.region "" $s3 | quote }}
- name: S3_BUCKET
  value: {{ ternary $s3v.bucket "" $s3 | quote }}
{{ include "exagram.secretEnv" (list $ctx "S3_ACCESS_KEY_ID" true) }}
{{ include "exagram.secretEnv" (list $ctx "S3_SECRET_ACCESS_KEY" true) }}
- name: S3_FORCE_PATH_STYLE
  value: {{ ternary (toString $s3v.forcePathStyle) "" (and $s3 (not (kindIs "invalid" $s3v.forcePathStyle))) | quote }}
- name: S3_HTTP_HOSTS
  value: {{ ternary $s3v.httpHosts "" $s3 | quote }}
- name: GCS_BUCKET
  value: {{ ternary $gcsv.bucket "" $gcs | quote }}
- name: GCS_PROJECT_ID
  value: {{ ternary $gcsv.projectId "" $gcs | quote }}
{{ include "exagram.secretEnv" (list $ctx "GCS_SERVICE_ACCOUNT_KEY_BASE64" true) }}
{{- if eq .app "api" }}
- name: GCS_CREATE_ONLY_UPLOADS
  value: "true"
{{- end }}
{{- end }}

{{/*
Keys a values `env` entry may set, per app, mirroring which deploy/compose.yml service passes each key.
`tunable` keys always render (default below, or env's value); `optional` keys render only when env sets
them, so a Secret in `envFrom` can supply them instead (an explicit env entry would win over envFrom).
*/}}
{{- define "exagram.envDefaults" -}}
NODE_ENV: production
LOG_LEVEL: info
DATABASE_MAX_CONNECTIONS: ""
MCP_RATE_LIMIT_PER_MINUTE: "60"
{{- end }}

{{- define "exagram.envKeys" -}}
api:
  tunable:
    - NODE_ENV
    - LOG_LEVEL
    - DATABASE_MAX_CONNECTIONS
    - MCP_RATE_LIMIT_PER_MINUTE
  optional:
    - GOOGLE_CLIENT_ID
    - GOOGLE_CLIENT_SECRET
worker:
  tunable: [NODE_ENV, LOG_LEVEL, DATABASE_MAX_CONNECTIONS]
  optional:
usercontent:
  tunable: [NODE_ENV, LOG_LEVEL, DATABASE_MAX_CONNECTIONS]
  optional: []
preflight:
  tunable: [NODE_ENV, LOG_LEVEL]
  optional: []
{{- end }}

{{/* The tunable and optional keys of one app. Takes (dict "ctx" . "app" "api"). */}}
{{- define "exagram.valuesEnv" -}}
{{- $ctx := .ctx }}
{{- $defaults := include "exagram.envDefaults" $ctx | fromYaml }}
{{- $keys := index (include "exagram.envKeys" $ctx | fromYaml) .app }}
{{- $env := $ctx.Values.env | default dict }}
{{- range $key := $keys.tunable }}
- name: {{ $key }}
  value: {{ (hasKey $env $key | ternary (index $env $key) (index $defaults $key)) | toString | quote }}
{{- end }}
{{- range $key := $keys.optional }}
{{- if hasKey $env $key }}
- name: {{ $key }}
  value: {{ index $env $key | toString | quote }}
{{- end }}
{{- end }}
{{- end }}

{{/* Pod-level security: non-root everywhere; fsGroup only where a claim is mounted. (dict "uid" 1000 "pvc" true). */}}
{{- define "exagram.podSecurityContext" -}}
securityContext:
  runAsNonRoot: true
  runAsUser: {{ .uid }}
  runAsGroup: {{ .uid }}
  {{- if .pvc }}
  fsGroup: {{ .uid }}
  fsGroupChangePolicy: OnRootMismatch
  {{- end }}
{{- end }}

{{- define "exagram.containerSecurityContext" -}}
securityContext:
  allowPrivilegeEscalation: false
  capabilities:
    drop: ["ALL"]
{{- end }}

{{/* nodeSelector, tolerations and affinity; the objects pod affinity is appended to the user's. (dict "ctx" . "objects" true). */}}
{{- define "exagram.scheduling" -}}
{{- $ctx := .ctx }}
{{- with $ctx.Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with $ctx.Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- $affinity := deepCopy ($ctx.Values.affinity | default dict) }}
{{- if and .objects (include "exagram.objectsAffinity" $ctx) }}
{{- $podAffinity := get $affinity "podAffinity" | default dict }}
{{- $required := get $podAffinity "requiredDuringSchedulingIgnoredDuringExecution" | default list }}
{{- $term := dict "labelSelector" (dict "matchLabels" (dict "exagram.io/objects" $ctx.Release.Name)) "topologyKey" "kubernetes.io/hostname" }}
{{- $_ := set $podAffinity "requiredDuringSchedulingIgnoredDuringExecution" (append $required $term) }}
{{- $_ := set $affinity "podAffinity" $podAffinity }}
{{- end }}
{{- with $affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/* Labels on the four Pods that mount the objects claim. */}}
{{- define "exagram.objectsLabel" -}}
{{- if include "exagram.filesystem" . -}}
exagram.io/objects: {{ .Release.Name | quote }}
{{- end }}
{{- end }}

{{/* podAnnotations plus, when the chart generates the Secret, a hash of it so a changed Secret rolls the Pods. */}}
{{- define "exagram.appPodAnnotations" -}}
{{- $annotations := deepCopy (.Values.podAnnotations | default dict) }}
{{- if not .Values.existingSecret }}
{{- $_ := set $annotations "checksum/secret" (include "exagram.secretChecksum" .) }}
{{- end }}
{{- with $annotations }}
annotations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/*
Hash of the generated Secret's keys that come from values. The random keys are kept once created, so they never change
it; hashing the rendered Secret instead would differ between the first install (fresh random values) and its first
upgrade, and roll every Pod for nothing.
*/}}
{{- define "exagram.secretChecksum" -}}
{{- $in := dict "bundled" .Values.database.bundled "driver" .Values.storage.driver }}
{{- if not .Values.database.bundled }}
{{- $_ := set $in "url" .Values.database.external.url }}
{{- $_ := set $in "migrateUrl" .Values.database.external.migrateUrl }}
{{- end }}
{{- if eq .Values.storage.driver "s3" }}
{{- $_ := set $in "s3" (pick .Values.storage.s3 "accessKeyId" "secretAccessKey") }}
{{- else if eq .Values.storage.driver "gcs" }}
{{- $_ := set $in "gcs" (pick .Values.storage.gcs "serviceAccountKeyBase64") }}
{{- end }}
{{- toJson $in | sha256sum }}
{{- end }}

{{- define "exagram.podAnnotations" -}}
{{- with .Values.podAnnotations }}
annotations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/*
Apps wait for the schema the migrate Job applies: the highest numeric prefix in /migrations, reported
by `migrate version` without "(dirty)". migrate prints the version, and its errors, on stderr.
*/}}
{{- define "exagram.waitForSchema" -}}
- name: wait-for-schema
  image: {{ include "exagram.image" (list . "migrate") }}
  imagePullPolicy: {{ .Values.image.pullPolicy }}
  command: ["/bin/sh", "-c"]
  args:
    - |
      set -eu
      target=$(ls /migrations/*.up.sql | sed -n 's|^/migrations/0*\([0-9][0-9]*\)_.*|\1|p' | sort -n | tail -n 1)
      echo "wait-for-schema: waiting for the database to report schema version $target, not dirty"
      while :; do
        got=$(migrate -path=/migrations -database="$MIGRATE_DATABASE_URL" version 2>&1 | tail -n 1 | sed 's|://[^@]*@|://***@|g') || true
        if [ "$got" = "$target" ]; then
          echo "wait-for-schema: schema is at $target"
          exit 0
        fi
        echo "wait-for-schema: database reports \"$got\", waiting for $target"
        sleep 3
      done
  env:
    {{- include "exagram.secretEnv" (list . "MIGRATE_DATABASE_URL") | nindent 4 }}
  {{- if include "exagram.dbCaMounted" . }}
  volumeMounts:
    - name: db-ca
      mountPath: /certs/db-ca.pem
      subPath: db-ca.pem
      readOnly: true
  {{- end }}
  resources:
    {{- toYaml .Values.resources.migrate | nindent 4 }}
  {{- include "exagram.containerSecurityContext" . | nindent 2 }}
{{- end }}

{{/* The database CA volume, mounted read-only at /certs/db-ca.pem, as compose.db-ca.yml does. */}}
{{- define "exagram.dbCaVolume" -}}
{{- if include "exagram.dbCaMounted" . }}
- name: db-ca
  secret:
    secretName: {{ .Values.database.external.caSecret.name | quote }}
    items:
      - key: {{ .Values.database.external.caSecret.key | quote }}
        path: db-ca.pem
{{- end }}
{{- end }}

{{- define "exagram.objectsVolume" -}}
{{- if include "exagram.filesystem" . }}
- name: objects
  persistentVolumeClaim:
    claimName: {{ include "exagram.componentName" (list . "objects") }}
{{- end }}
{{- end }}
