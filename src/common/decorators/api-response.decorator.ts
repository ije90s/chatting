import { applyDecorators, HttpStatus, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { ErrorCode } from '../errors/error-code';

// 성공 응답 { success: true, data: <model> } 스키마
export function ApiSuccessResponse(
  model: Type<unknown>,
  status: HttpStatus = HttpStatus.OK,
  description?: string,
) {
  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status,
      description,
      schema: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { $ref: getSchemaPath(model) },
        },
      },
    }),
  );
}

// 실패 응답 { success: false, code, message } 스키마
export function ApiErrorResponse(status: HttpStatus, ...codes: ErrorCode[]) {
  return ApiResponse({
    status,
    description: codes.join(', '),
    type: ErrorResponseDto,
  });
}
