{{- define "eventforge.name" -}}eventforge{{- end -}}
{{- define "eventforge.fullname" -}}{{ .Release.Name }}-{{ include "eventforge.name" . }}{{- end -}}
