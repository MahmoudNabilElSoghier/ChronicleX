import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListEntriesDto } from '../dto/list-entries.dto';

async function serialFieldErrors(
  field: 'serialFrom' | 'serialTo',
  value: string,
): Promise<Array<{ property: string; constraints?: Record<string, string> }>> {
  const dto = plainToInstance(ListEntriesDto, { [field]: value });
  const errors = await validate(dto);
  return errors.filter((e) => e.property === field);
}

describe('ListEntriesDto serial range validation', () => {
  it("'6200000001' passes for both fields", async () => {
    expect(await serialFieldErrors('serialFrom', '6200000001')).toEqual([]);
    expect(await serialFieldErrors('serialTo', '6200000001')).toEqual([]);
  });

  it("'620000000' (9 digits) fails with the digit message", async () => {
    const errors = await serialFieldErrors('serialFrom', '620000000');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toEqual({
      matches: 'serialFrom must be exactly 10 digits',
    });
  });

  it("'62000000001' (11 digits) fails", async () => {
    const errors = await serialFieldErrors('serialTo', '62000000001');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints?.matches).toBe('serialTo must be exactly 10 digits');
  });

  it("'abcdefghij' fails", async () => {
    expect(await serialFieldErrors('serialFrom', 'abcdefghij')).toHaveLength(1);
    expect(await serialFieldErrors('serialTo', 'abcdefghij')).toHaveLength(1);
  });

  it('omitting both fields is valid (range is optional)', async () => {
    const dto = plainToInstance(ListEntriesDto, {});
    expect(await validate(dto)).toEqual([]);
  });
});
