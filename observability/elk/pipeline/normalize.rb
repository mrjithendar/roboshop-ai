# Logstash Ruby filter. Treat application logs as untrusted input. Never copy raw
# messages, customer identifiers, URLs, prompts, headers, or exception text into
# the indexed document. Retain bounded diagnostic codes and trace correlation.
require 'json'
require 'bigdecimal'
require 'time'

def register(params); end

def safe_code(value)
  value.is_a?(String) && value.match?(/\A[A-Za-z][A-Za-z0-9_.:\/-]{0,119}\z/) ? value : nil
end

def filter(event)
  raw = event.get('message').to_s
  metadata = event.get('[kubernetes]') || {}
  namespace = metadata['namespace']
  return [] unless ['roboshop-ai', 'traefik'].include?(namespace)
  timestamp = event.get('@timestamp')
  record = {}
  bad = false
  if raw.lstrip.start_with?('{', '[')
    begin
      record = JSON.parse(raw)
      bad = !record.is_a?(Hash)
      record = {} if bad
    rescue JSON::ParserError
      bad = true
    end
  else
    # Spring/Java, RabbitMQ and traditional NGINX: extract severity and exception
    # class only. Multiline stack traces have already been joined by Filebeat.
    level = raw[/\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\b/i, 1]
    level ||= raw[/\[(error|warn|crit|alert|emerg|notice|info|debug)\]/i, 1]
    record['level'] = level if level
    record['event'] = 'plaintext_log'
    record['errorType'] = raw[/\b([A-Za-z][A-Za-z0-9_.]*(?:Exception|Error))\b/, 1]
    if (match = raw.match(/\A(\d{4}-\d{2}-\d{2}T[^\s]+)\s/))
      record['timestamp'] = match[1]
    end
  end
  # Rebuild from an allowlist; no accidental payload preservation via event.original.
  event.to_hash.keys.each { |key| event.remove(key) }
  event.set('@timestamp', timestamp) if timestamp
  event.set('[deployment][environment]', 'minikube-lab')
  event.set('[kubernetes][namespace]', namespace)
  container = metadata.dig('container', 'name')
  event.set('[service][name]', safe_code(container) || 'unknown')
  version = record['version'] || record['serviceVersion']
  event.set('[service][version]', version) if version.is_a?(String) && version.match?(/\A[0-9][A-Za-z0-9.+-]{0,49}\z/)
  action = safe_code(record['event']) || safe_code(record['operation']) || 'application_log'
  event.set('[event][action]', bad ? 'malformed_record' : action)
  event.set('[message]', bad ? 'Malformed record; raw payload discarded' : action)
  level = (record['level'] || 'INFO').to_s.upcase
  event.set('[log][level]', level.match?(/\A(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|CRIT|ALERT|EMERG|NOTICE)\z/) ? level.downcase : 'info')
  %w[trace span].each do |kind|
    value = record[kind+'_id'] || record[kind+'Id'] || record.dig(kind, 'id') rescue nil
    size = kind == 'trace' ? 32 : 16
    event.set("[#{kind}][id]", value.downcase) if value.is_a?(String) && value.match?(/\A[0-9a-fA-F]{#{size}}\z/) && value !~ /\A0+\z/
  end
  method = record['method'] || record['RequestMethod']
  event.set('[http][request][method]', method) if %w[GET POST PUT PATCH DELETE HEAD OPTIONS].include?(method)
  status = record['status'] || record['DownstreamStatus']
  event.set('[http][response][status_code]', status.to_i) if status.to_s.match?(/\A[1-5][0-9]{2}\z/)
  # Node/Python/Go milliseconds; NGINX seconds; Traefik JSON Duration nanoseconds.
  duration, factor = if record.key?('durationMs')
    [record['durationMs'], 1_000_000]
  elsif record.key?('Duration')
    [record['Duration'], 1]
  elsif container == 'nginx'
    [record['duration'], 1_000_000_000]
  end
  if duration && duration.to_s.match?(/\A\d{1,12}(?:\.\d{1,9})?\z/)
    nanos = (BigDecimal(duration.to_s)*factor).to_i
    event.set('[event][duration]', nanos) if nanos < 9_223_372_036_854_775_807
  end
  source_time = record['timestamp'] || record['time']
  if source_time.is_a?(String) && source_time.match?(/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})\z/)
    begin
      Time.iso8601(source_time)
      event.set('[event][created]', source_time) # ES ingest converts without millisecond truncation.
    rescue ArgumentError
      bad = true
    end
  end
  %w[errorCode errorType provider outcome].each do |key|
    value = safe_code(record[key])
    event.set('[diagnostic]['+key+']', value) if value
  end
  # Unknown keys are deliberately not indexed, even under an unindexed raw object:
  # storing raw payloads would still expose secrets through _source and Kibana.
  event.set('[@metadata][target]', bad ? 'roboshop-malformed' : 'roboshop-logs')
  [event]
rescue StandardError
  # Fail closed, and never put the offending payload into Logstash diagnostics.
  event.to_hash.keys.each { |key| event.remove(key) }
  event.set('@timestamp', timestamp) if timestamp
  event.set('[event][action]', 'normalization_failed')
  event.set('[message]', 'Normalization failed; raw payload discarded')
  event.set('[@metadata][target]', 'roboshop-malformed')
  [event]
end
