// The shape of a customer profile as sent by the browser, shared by creating a profile
// (POST /api/customers) and editing one (PATCH /api/customers). `is_pep` is deliberately
// absent: it is the application's own q_pep answer, never a profile field.
import { z } from 'zod';
import { countryCodeSchema, employmentSchema } from '@/data/schemas';

export const customerInputSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('consumer'),
    name: z.string().min(1),
    country: countryCodeSchema,
    city: z.string().min(1),
    email: z.email(),
    birthDate: z.iso.date(),
    employment: employmentSchema,
    monthlyNetIncomeCents: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('sole_trader'),
    name: z.string().min(1),
    country: countryCodeSchema,
    city: z.string().min(1),
    email: z.email(),
    birthDate: z.iso.date(),
    businessId: z.string().min(1),
    vatRegistered: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('company'),
    name: z.string().min(1),
    country: countryCodeSchema,
    city: z.string().min(1),
    email: z.email(),
    businessId: z.string().min(1),
    vatRegistered: z.boolean(),
    annualRevenueCents: z.number().int().nonnegative(),
    applicantCanSign: z.boolean(),
    beneficialOwners: z.array(z.string()).optional(),
  }),
]);

export type CustomerInput = z.infer<typeof customerInputSchema>;
