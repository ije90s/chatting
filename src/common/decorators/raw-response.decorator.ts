import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE = 'rawResponse';

// 응답을 { success: true, data }로 감싸지 않는다. 형식이 정해진 외부 규격(Prometheus 텍스트 등)에만 쓴다.
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);
