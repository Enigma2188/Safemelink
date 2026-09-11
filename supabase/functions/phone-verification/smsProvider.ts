export type SmsProviderResult = { messageReference: string | null };

export class SmsProviderError extends Error {
  constructor(readonly category: 'not_configured' | 'timeout' | 'rejected' | 'network') {
    super(category);
    this.name = 'SmsProviderError';
  }
}

type ProviderConfig = {
  endpoint: URL;
  accessToken: string;
  sender: string;
  acceptedStatus: number;
  acceptanceField: string;
  acceptanceValue: string;
  messageIdField: string | null;
};

const PROVIDER_TIMEOUT_MS = 10_000;
const MAX_PROVIDER_RESPONSE_BYTES = 4_096;
const CONFIG_FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const APPROVED_HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const readBoundedResponse = async (response: Response) => {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel();
        throw new SmsProviderError('rejected');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
};

const parseProviderConfig = (): ProviderConfig | null => {
  const endpointValue = Deno.env.get('PHONE_OTP_PROVIDER_URL');
  const approvedHost = Deno.env.get('PHONE_OTP_PROVIDER_ALLOWED_HOST')?.trim().toLowerCase();
  const accessToken = Deno.env.get('PHONE_OTP_PROVIDER_TOKEN');
  const sender = Deno.env.get('PHONE_OTP_PROVIDER_SENDER');
  const acceptedStatus = Number(Deno.env.get('PHONE_OTP_PROVIDER_ACCEPTED_STATUS'));
  const acceptanceField = Deno.env.get('PHONE_OTP_PROVIDER_ACCEPTANCE_FIELD');
  const acceptanceValue = Deno.env.get('PHONE_OTP_PROVIDER_ACCEPTANCE_VALUE');
  const messageIdFieldValue = Deno.env.get('PHONE_OTP_PROVIDER_MESSAGE_ID_FIELD');

  if (!endpointValue || !approvedHost || !accessToken || !sender
    || !Number.isInteger(acceptedStatus) || acceptedStatus < 200 || acceptedStatus > 299
    || !acceptanceField || !CONFIG_FIELD_PATTERN.test(acceptanceField)
    || !acceptanceValue || acceptanceValue.length > 128
    || (messageIdFieldValue && !CONFIG_FIELD_PATTERN.test(messageIdFieldValue))
    || !APPROVED_HOST_PATTERN.test(approvedHost)
    || /^\d+(?:\.\d+){3}$/.test(approvedHost)
    || approvedHost.endsWith('.localhost') || approvedHost.endsWith('.local')
    || approvedHost.endsWith('.internal')) {
    return null;
  }

  let endpoint: URL;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    return null;
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password
    || (endpoint.port && endpoint.port !== '443')
    || endpoint.hostname.toLowerCase() !== approvedHost) {
    return null;
  }

  return {
    endpoint,
    accessToken,
    sender,
    acceptedStatus,
    acceptanceField,
    acceptanceValue,
    messageIdField: messageIdFieldValue || null,
  };
};

const parseAcceptedResponse = async (response: Response, config: ProviderConfig) => {
  if (response.status !== config.acceptedStatus) throw new SmsProviderError('rejected');
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new SmsProviderError('rejected');

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new SmsProviderError('rejected');
  }
  const responseText = await readBoundedResponse(response);
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(responseText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('PROVIDER_RESPONSE');
    }
    body = parsed as Record<string, unknown>;
  } catch {
    throw new SmsProviderError('rejected');
  }
  if (body[config.acceptanceField] !== config.acceptanceValue) {
    throw new SmsProviderError('rejected');
  }

  const messageReference = config.messageIdField ? body[config.messageIdField] : null;
  return {
    messageReference: typeof messageReference === 'string' && messageReference.length <= 256
      ? messageReference
      : null,
  };
};

export async function sendVerificationSms(phone: string, otp: string): Promise<SmsProviderResult> {
  const config = parseProviderConfig();
  if (!config) throw new SmsProviderError('not_configured');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: config.sender,
        to: phone,
        message: `SafeMeLink: il tuo codice di verifica è ${otp}. Scade tra 10 minuti.`,
      }),
      redirect: 'error',
      signal: controller.signal,
    });
    return await parseAcceptedResponse(response, config);
  } catch (error) {
    if (error instanceof SmsProviderError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new SmsProviderError('timeout');
    }
    throw new SmsProviderError('network');
  } finally {
    clearTimeout(timeoutId);
  }
}
