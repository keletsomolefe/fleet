import { BadRequestError } from '../../../shared/errors.js';
import { isUuid } from '../../../shared/identifiers.js';
import { strictObject } from '../../../shared/validation.js';
import type { User } from '../domain/user.entity.js';

export interface CreateUserDto {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
}

export interface UpdateUserAccessDto {
  roleIds: string[];
  isActive: boolean;
}

export interface UserProfileDto {
  id: string;
  identityId: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface AdminUserSummaryDto extends UserProfileDto {
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export function toUserProfileDto(user: User): UserProfileDto {
  return {
    id: user.id,
    identityId: user.kratosIdentityId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

export function toAdminUserSummaryDto(user: User): AdminUserSummaryDto {
  return {
    ...toUserProfileDto(user),
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

export function parseUserInput(value: unknown): CreateUserDto {
  const input = strictObject(
    value,
    ['email', 'firstName', 'lastName', 'password'],
    'Enter the user details.',
    'Unexpected account fields.',
  );
  const email =
    typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const firstName =
    typeof input.firstName === 'string' ? input.firstName.trim() : '';
  const lastName =
    typeof input.lastName === 'string' ? input.lastName.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new BadRequestError('Enter a valid email address.');
  }
  if (
    !firstName ||
    !lastName ||
    firstName.length > 100 ||
    lastName.length > 100
  ) {
    throw new BadRequestError(
      'Enter first and last names of up to 100 characters.',
    );
  }
  if (password.length < 8 || password.length > 128) {
    throw new BadRequestError('Use a password between 8 and 128 characters.');
  }
  return { email, firstName, lastName, password };
}

export function parseAccessInput(raw: unknown): UpdateUserAccessDto {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestError('Invalid access details.');
  }
  const input = raw as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !['roleIds', 'isActive'].includes(key)) ||
    typeof input.isActive !== 'boolean' ||
    !Array.isArray(input.roleIds) ||
    input.roleIds.length > 20 ||
    input.roleIds.some((id) => !isUuid(id))
  ) {
    throw new BadRequestError('Select valid roles and account status.');
  }
  return {
    roleIds: [...new Set(input.roleIds as string[])],
    isActive: input.isActive,
  };
}

export function parseUserSearch(query = '', rawPage = '1') {
  if (
    typeof query !== 'string' ||
    query.length > 200 ||
    typeof rawPage !== 'string' ||
    !/^[1-9]\d{0,5}$/.test(rawPage)
  ) {
    throw new BadRequestError('Invalid user search.');
  }
  return { query: query.trim(), page: Number(rawPage) };
}
