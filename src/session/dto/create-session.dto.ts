import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

// 기본 표시가 이모지인 문자, 이모지 표시 선택자(U+FE0F), 키캡(U+20E3)이 없어야 한다.
// ©, ™처럼 기본 표시가 텍스트인 기호는 허용한다.
const NO_EMOJI = /^[^\p{Emoji_Presentation}\u{FE0F}\u{20E3}]*$/u;

export class CreateSessionDto {
  @ApiProperty({
    example: '상담 문의',
    minLength: 1,
    maxLength: 100,
    description: '앞뒤 공백을 제거한 뒤 1~100자. 이모지는 쓸 수 없다.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  @Matches(NO_EMOJI, { message: 'title에는 이모지를 쓸 수 없습니다.' })
  title: string;
}
