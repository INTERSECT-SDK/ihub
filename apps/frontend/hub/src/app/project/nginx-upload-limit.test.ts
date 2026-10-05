import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const nginxVariants = [
  {
    name: 'production',
    template: '../../../../../backend/nginx/default.conf',
    renderer: '../../../../../backend/nginx/render-upload-body-limit.sh',
  },
  {
    name: 'development',
    template: '../../../../../backend/nginx_dev/default.conf',
    renderer: '../../../../../backend/nginx_dev/render-upload-body-limit.sh',
  },
]

const maximumSafeRawBytes = '4611686018427387368'
const productionRenderer = nginxVariants[0].renderer
const productionTemplate = nginxVariants[0].template
const developmentRenderer = nginxVariants[1].renderer
const developmentTemplate = nginxVariants[1].template
const developmentUpstreams = {
  NGINX_HUB_UPSTREAM: 'host.docker.internal:3000',
  NGINX_MARKETPLACE_UPSTREAM: 'host.docker.internal:3001',
  NGINX_SERVER_UPSTREAM: 'host.docker.internal:8000',
  NGINX_DOCS_UPSTREAM: 'host.docker.internal:3002',
  NGINX_MCP_UPSTREAM: 'host.docker.internal:8100',
}

function getLocationBlock(config: string, location: string): string {
  const escapedLocation = location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = config.match(
    new RegExp(`location\\s+${escapedLocation}\\s*\\{([\\s\\S]*?)\\n  \\}`),
  )

  assert.ok(match?.[1], `Missing Nginx location ${location}`)
  return match[1]
}

function getProxyPasses(config: string): string[] {
  return [...config.matchAll(/proxy_pass\s+([^;]+);/g)].map((match) => match[1])
}

function renderLimits(
  renderer: string,
  rawBytes: string,
  directory: string,
  suffix: string,
): string {
  const templatePath = join(directory, `template-${suffix}.conf`)
  const outputPath = join(directory, `rendered-${suffix}.conf`)
  writeFileSync(
    templatePath,
    [
      'upload=__PROJECT_FILE_UPLOAD_MAX_BODY_BYTES__',
      'editor=__PROJECT_FILE_EDITOR_MAX_BODY_BYTES__',
    ].join('\n'),
  )
  execFileSync(
    '/bin/sh',
    [
      fileURLToPath(new URL(renderer, import.meta.url)),
      templatePath,
      outputPath,
    ],
    {
      env: {
        ...process.env,
        ...developmentUpstreams,
        NGINX_SERVER_NAME: 'ihub.example.com',
        PROJECT_FILE_UPLOAD_MAX_BYTES: rawBytes,
      },
    },
  )
  return readFileSync(outputPath, 'utf8')
}

function renderDevelopmentConfig(
  directory: string,
  suffix: string,
  upstreams: NodeJS.ProcessEnv,
): string {
  const outputPath = join(directory, `rendered-${suffix}.conf`)
  execFileSync(
    '/bin/sh',
    [
      fileURLToPath(new URL(developmentRenderer, import.meta.url)),
      fileURLToPath(new URL(developmentTemplate, import.meta.url)),
      outputPath,
    ],
    {
      env: {
        ...process.env,
        PROJECT_FILE_UPLOAD_MAX_BYTES: '12000',
        ...upstreams,
      },
    },
  )
  return readFileSync(outputPath, 'utf8')
}

test('all Nginx renderers derive separate upload and editor limits', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ihub-nginx-limits-'))
  const rawBytes = 12_000
  const uploadLimit = 4 * Math.ceil(rawBytes / 3) + 46 + 1024
  const editorLimit = 2 * rawBytes + 46 + 1024

  try {
    nginxVariants.forEach(({ renderer }, index) => {
      const rendered = renderLimits(
        renderer,
        String(rawBytes),
        directory,
        String(index),
      )
      assert.equal(rendered, `upload=${uploadLimit}\neditor=${editorLimit}`)
    })

    const base64Content = Buffer.alloc(rawBytes).toString('base64')
    const uploadBody = JSON.stringify({
      type: 'file',
      format: 'base64',
      content: base64Content,
    })
    assert.ok(Buffer.byteLength(uploadBody) <= uploadLimit)

    const escapedText = '\\"'.repeat(rawBytes / 2)
    assert.equal(Buffer.byteLength(escapedText), rawBytes)
    const editorBody = JSON.stringify({
      type: 'file',
      format: 'text',
      content: escapedText,
    })
    assert.ok(Buffer.byteLength(editorBody) <= editorLimit)
    assert.ok(Buffer.byteLength(editorBody) > uploadLimit)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('all Nginx renderers reject values beyond safe shell arithmetic', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ihub-nginx-boundary-'))

  try {
    nginxVariants.forEach(({ renderer }, index) => {
      assert.match(
        renderLimits(renderer, maximumSafeRawBytes, directory, `max-${index}`),
        /^upload=\d+\neditor=9223372036854775806$/,
      )

      const templatePath = join(directory, `template-over-${index}.conf`)
      const outputPath = join(directory, `rendered-over-${index}.conf`)
      writeFileSync(templatePath, '__PROJECT_FILE_EDITOR_MAX_BODY_BYTES__')
      const result = spawnSync(
        '/bin/sh',
        [
          fileURLToPath(new URL(renderer, import.meta.url)),
          templatePath,
          outputPath,
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            ...developmentUpstreams,
            NGINX_SERVER_NAME: 'ihub.example.com',
            PROJECT_FILE_UPLOAD_MAX_BYTES: '4611686018427387369',
          },
        },
      )
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /too large to derive an Nginx body limit/)
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('all Nginx templates assign route-specific rendered limits', () => {
  nginxVariants.forEach(({ template }) => {
    const config = readFileSync(new URL(template, import.meta.url), 'utf8')

    assert.match(
      getLocationBlock(config, '/api'),
      /client_max_body_size __PROJECT_FILE_UPLOAD_MAX_BODY_BYTES__;/,
      `${template} must apply the upload limit to /api`,
    )
    assert.match(
      getLocationBlock(config, '/ijupyterhub/'),
      /client_max_body_size __PROJECT_FILE_EDITOR_MAX_BODY_BYTES__;/,
      `${template} must apply the editor limit to /ijupyterhub/`,
    )
  })
})

test('production renderer injects a validated server name and fixed TLS paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ihub-nginx-production-'))
  const outputPath = join(directory, 'rendered.conf')

  try {
    execFileSync(
      '/bin/sh',
      [
        fileURLToPath(new URL(productionRenderer, import.meta.url)),
        fileURLToPath(new URL(productionTemplate, import.meta.url)),
        outputPath,
      ],
      {
        env: {
          ...process.env,
          NGINX_SERVER_NAME: 'public.ihub.example.com',
          PROJECT_FILE_UPLOAD_MAX_BYTES: '12000',
        },
      },
    )

    const config = readFileSync(outputPath, 'utf8')
    assert.equal(
      config.match(/server_name public\.ihub\.example\.com;/g)?.length,
      2,
    )
    assert.match(config, /ssl_certificate \/run\/secrets\/tls_certificate;/)
    assert.match(config, /ssl_certificate_key \/run\/secrets\/tls_private_key;/)
    assert.doesNotMatch(config, /__[A-Z0-9_]+__/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('production renderer rejects missing or malformed server names', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ihub-nginx-hostname-'))
  const rendererPath = fileURLToPath(
    new URL(productionRenderer, import.meta.url),
  )
  const templatePath = fileURLToPath(
    new URL(productionTemplate, import.meta.url),
  )

  function renderWith(serverName: string) {
    return spawnSync(
      '/bin/sh',
      [rendererPath, templatePath, join(directory, 'rendered.conf')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NGINX_SERVER_NAME: serverName,
          PROJECT_FILE_UPLOAD_MAX_BYTES: '12000',
        },
      },
    )
  }

  try {
    for (const serverName of ['', 'bad host', 'bad;host', '.example.com']) {
      const result = renderWith(serverName)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /NGINX_SERVER_NAME/)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('development renderer selects lightweight and full-stack upstreams', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ihub-nginx-upstreams-'))

  try {
    const lightweightConfig = renderDevelopmentConfig(directory, 'light', {
      ...developmentUpstreams,
      NGINX_OLLAMA_UPSTREAM: 'host.docker.internal:11434',
    })
    const fullConfig = renderDevelopmentConfig(directory, 'full', {
      NGINX_HUB_UPSTREAM: 'ui:3000',
      NGINX_MARKETPLACE_UPSTREAM: 'marketplace:3001',
      NGINX_SERVER_UPSTREAM: 'server:8000',
      NGINX_DOCS_UPSTREAM: 'docs:3002',
      NGINX_MCP_UPSTREAM: 'mcp:8100',
      NGINX_OLLAMA_UPSTREAM: '',
    })

    assert.deepEqual(getProxyPasses(lightweightConfig), [
      'http://host.docker.internal:3000',
      'http://ihub-jupyterhub:8000',
      'http://ihub-keycloak:8080',
      'http://host.docker.internal:3001',
      'http://host.docker.internal:8000/api',
      'http://host.docker.internal:3002/',
      'http://host.docker.internal:8000/docs',
      'http://host.docker.internal:8000/openapi.json',
      'http://host.docker.internal:11434/',
      'http://host.docker.internal:8100/',
    ])
    assert.deepEqual(getProxyPasses(fullConfig), [
      'http://ui:3000',
      'http://ihub-jupyterhub:8000',
      'http://ihub-keycloak:8080',
      'http://marketplace:3001',
      'http://server:8000/api',
      'http://docs:3002/',
      'http://server:8000/docs',
      'http://server:8000/openapi.json',
      'http://mcp:8100/',
    ])

    assert.match(
      getLocationBlock(lightweightConfig, '/hub'),
      /proxy_pass http:\/\/host\.docker\.internal:3000;/,
    )
    assert.match(
      getLocationBlock(lightweightConfig, '/'),
      /proxy_pass http:\/\/host\.docker\.internal:3001;/,
    )
    assert.match(
      getLocationBlock(lightweightConfig, '/api'),
      /proxy_pass http:\/\/host\.docker\.internal:8000\/api;/,
    )
    assert.match(
      getLocationBlock(lightweightConfig, '/docs/'),
      /proxy_pass http:\/\/host\.docker\.internal:3002\/;/,
    )
    assert.match(
      getLocationBlock(lightweightConfig, '/ihub_mcp/'),
      /proxy_pass http:\/\/host\.docker\.internal:8100\/;/,
    )
    assert.match(
      getLocationBlock(lightweightConfig, '/ihub_ollama/'),
      /proxy_pass http:\/\/host\.docker\.internal:11434\/;/,
    )

    assert.match(
      getLocationBlock(fullConfig, '/hub'),
      /proxy_pass http:\/\/ui:3000;/,
    )
    assert.match(
      getLocationBlock(fullConfig, '/'),
      /proxy_pass http:\/\/marketplace:3001;/,
    )
    assert.match(
      getLocationBlock(fullConfig, '/api'),
      /proxy_pass http:\/\/server:8000\/api;/,
    )
    assert.match(
      getLocationBlock(fullConfig, '/docs/'),
      /proxy_pass http:\/\/docs:3002\/;/,
    )
    assert.match(
      getLocationBlock(fullConfig, '/ihub_mcp/'),
      /proxy_pass http:\/\/mcp:8100\/;/,
    )
    assert.doesNotMatch(fullConfig, /location \/ihub_ollama\//)

    for (const config of [lightweightConfig, fullConfig]) {
      assert.match(
        getLocationBlock(config, '/api'),
        /client_max_body_size 17070;/,
      )
      assert.match(
        getLocationBlock(config, '/ijupyterhub/'),
        /client_max_body_size 25070;/,
      )
      assert.doesNotMatch(config, /__[A-Z0-9_]+__/)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('development renderer reports each missing or malformed upstream', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ihub-nginx-validation-'))
  const rendererPath = fileURLToPath(
    new URL(developmentRenderer, import.meta.url),
  )
  const templatePath = fileURLToPath(
    new URL(developmentTemplate, import.meta.url),
  )

  function renderWith(upstreams: NodeJS.ProcessEnv) {
    return spawnSync(
      '/bin/sh',
      [rendererPath, templatePath, join(directory, 'rendered.conf')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PROJECT_FILE_UPLOAD_MAX_BYTES: '12000',
          ...upstreams,
        },
      },
    )
  }

  try {
    for (const variableName of Object.keys(developmentUpstreams)) {
      const missingUpstreams: NodeJS.ProcessEnv = {
        ...developmentUpstreams,
        [variableName]: '',
      }
      const missingResult = renderWith(missingUpstreams)
      assert.notEqual(missingResult.status, 0)
      assert.match(missingResult.stderr, new RegExp(variableName))

      const malformedResult = renderWith({
        ...developmentUpstreams,
        [variableName]: 'http://invalid:8000/path',
      })
      assert.notEqual(malformedResult.status, 0)
      assert.match(malformedResult.stderr, new RegExp(variableName))
    }

    const malformedOllamaResult = renderWith({
      ...developmentUpstreams,
      NGINX_OLLAMA_UPSTREAM: 'host-without-port',
    })
    assert.notEqual(malformedOllamaResult.status, 0)
    assert.match(malformedOllamaResult.stderr, /NGINX_OLLAMA_UPSTREAM/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
