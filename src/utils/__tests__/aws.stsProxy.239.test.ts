/**
 * densable 2.1.239 #8 — iYd STS pre-check + LMt endpoint for HTTPS_PROXY.
 * Does not mock @aws-sdk/client-sts (process-global mock.module).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { getStsEndpointUrl } from '../aws.js'
import { getAWSClientProxyConfig } from '../proxy.js'

describe('densable 2.1.239 #8 STS endpoint + proxy config', () => {
  const prevSts = process.env.AWS_ENDPOINT_URL_STS
  const prevUrl = process.env.AWS_ENDPOINT_URL
  const prevHttps = process.env.HTTPS_PROXY
  const prevHttp = process.env.HTTP_PROXY
  const prevNo = process.env.NO_PROXY

  afterEach(() => {
    if (prevSts === undefined) delete process.env.AWS_ENDPOINT_URL_STS
    else process.env.AWS_ENDPOINT_URL_STS = prevSts
    if (prevUrl === undefined) delete process.env.AWS_ENDPOINT_URL
    else process.env.AWS_ENDPOINT_URL = prevUrl
    if (prevHttps === undefined) delete process.env.HTTPS_PROXY
    else process.env.HTTPS_PROXY = prevHttps
    if (prevHttp === undefined) delete process.env.HTTP_PROXY
    else process.env.HTTP_PROXY = prevHttp
    if (prevNo === undefined) delete process.env.NO_PROXY
    else process.env.NO_PROXY = prevNo
  })

  test('LMt: regional default, then AWS_ENDPOINT_URL, then STS-specific', () => {
    delete process.env.AWS_ENDPOINT_URL_STS
    delete process.env.AWS_ENDPOINT_URL
    expect(getStsEndpointUrl('eu-west-1')).toBe(
      'https://sts.eu-west-1.amazonaws.com',
    )

    process.env.AWS_ENDPOINT_URL = 'https://sts.vpce.example'
    expect(getStsEndpointUrl('eu-west-1')).toBe('https://sts.vpce.example')

    process.env.AWS_ENDPOINT_URL_STS = 'https://sts.custom.example'
    expect(getStsEndpointUrl('eu-west-1')).toBe('https://sts.custom.example')
  })

  test('NMt: no proxy → {}; HTTPS_PROXY → requestHandler', async () => {
    delete process.env.HTTPS_PROXY
    delete process.env.HTTP_PROXY
    delete process.env.NO_PROXY
    expect(
      await getAWSClientProxyConfig({
        url: getStsEndpointUrl('us-east-1'),
        region: 'us-east-1',
        requestTimeoutMs: 30_000,
      }),
    ).toEqual({})

    process.env.HTTPS_PROXY = 'http://proxy.example:8080'
    const cfg = (await getAWSClientProxyConfig({
      url: getStsEndpointUrl('us-east-1'),
      region: 'us-east-1',
      requestTimeoutMs: 30_000,
    })) as { requestHandler?: unknown }
    expect(cfg.requestHandler).toBeDefined()
  })
})
