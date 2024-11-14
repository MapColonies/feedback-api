{{/*
Common labels
*/}}
{{- define "feedback-api.labels" -}}
helm.sh/chart: {{ include "feedback-api.chart" . }}
{{ include "feedback-api.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Returns the tag of the chart.
*/}}
{{- define "feedback-api.tag" -}}
{{- default (printf "v%s" .Chart.AppVersion) .Values.image.tag }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "feedback-api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "feedback-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Returns the environment from global if exists or from the chart's values, defaults to development
*/}}
{{- define "feedback-api.environment" -}}
{{- if .Values.global.environment }}
    {{- .Values.global.environment -}}
{{- else -}}
    {{- .Values.environment | default "development" -}}
{{- end -}}
{{- end -}}

{{/*
Returns the tracing url from global if exists or from the chart's values
*/}}
{{- define "feedback-api.tracingUrl" -}}
{{- if .Values.global.tracing.url }}
    {{- .Values.global.tracing.url -}}
{{- else if .Values.env.tracing.url -}}
    {{- .Values.env.tracing.url -}}
{{- end -}}
{{- end -}}

{{/*
Returns the tracing url from global if exists or from the chart's values
*/}}
{{- define "feedback-api.metricsUrl" -}}
{{- if .Values.global.metrics.url }}
    {{- .Values.global.metrics.url -}}
{{- else -}}
    {{- .Values.env.metrics.url -}}
{{- end -}}
{{- end -}}

{{/*
Return the proper image name
*/}}
{{- define "feedback-api.image" -}}
{{ include "common.images.image" (dict "imageRoot" .Values.image "global" .Values.global) }}
{{- end -}}


{{/*
Return the proper Docker Image Registry Secret Names
*/}}
{{- define "feedback-api.imagePullSecrets" -}}
{{ include "common.images.renderPullSecrets" (dict "images" (list .Values.image) "context" $) }}
{{- end -}}

{{/*
Return the proper image pullPolicy
*/}}
{{- define "feedback-api.pullPolicy" -}}
{{ include "common.images.pullPolicy" (dict "imageRoot" .Values.image "global" .Values.global) }}
{{- end -}}

{{/*
Return the proper image deploymentFlavor
*/}}
{{- define "feedback-api.deploymentFlavor" -}}
{{ include "common.images.deploymentFlavor" (dict "imageRoot" .Values.image "global" .Values.global) }}
{{- end -}}


{{/*
Return the proper fully qualified app name
*/}}
{{- define "feedback-api.fullname" -}}
{{ include "common.names.fullname" . }}
{{- end -}}

{{/*
Return the proper chart name
*/}}
{{- define "feedback-api.name" -}}
{{ include "common.names.name" . }}
{{- end -}}

{{/*
Return the proper chart name
*/}}
{{- define "feedback-api.chart" -}}
{{ include "common.names.chart" . }}
{{- end -}}
