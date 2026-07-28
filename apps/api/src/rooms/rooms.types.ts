import { ObjectType, Field, InputType, Int, registerEnumType } from '@nestjs/graphql';
import { RoomStatus, SlotType } from '@prisma/client';

registerEnumType(RoomStatus, { name: 'RoomStatus' });
registerEnumType(SlotType, { name: 'SlotType' });

@ObjectType()
export class RoomEntity {
  @Field() id!: string;
  @Field() eventId!: string;
  @Field() name!: string;
  @Field(() => Int, { nullable: true }) capacity?: number;
  @Field({ nullable: true }) locationDescription?: string;
  @Field() isVirtual!: boolean;
  @Field() hasVideoConferencing!: boolean;
  @Field(() => RoomStatus) status!: RoomStatus;
  @Field() createdAt!: Date;
}

@InputType()
export class CreateRoomInput {
  @Field() eventId!: string;
  @Field() name!: string;
  @Field(() => Int, { nullable: true }) capacity?: number;
  @Field({ nullable: true }) locationDescription?: string;
  @Field({ defaultValue: false }) isVirtual!: boolean;
  @Field({ defaultValue: false }) hasVideoConferencing!: boolean;
}

@InputType()
export class UpdateRoomInput {
  @Field({ nullable: true }) name?: string;
  @Field(() => Int, { nullable: true }) capacity?: number;
  @Field({ nullable: true }) locationDescription?: string;
  @Field({ nullable: true }) isVirtual?: boolean;
  @Field({ nullable: true }) hasVideoConferencing?: boolean;
  @Field(() => RoomStatus, { nullable: true }) status?: RoomStatus;
}

@ObjectType()
export class TimeSlotEntity {
  @Field() id!: string;
  @Field() eventId!: string;
  @Field() date!: Date;
  @Field() startTime!: Date;
  @Field() endTime!: Date;
  @Field(() => SlotType) slotType!: SlotType;
  @Field() createdAt!: Date;
}

@InputType()
export class GenerateTimeSlotsInput {
  @Field() eventId!: string;
  @Field() date!: Date;
  @Field() operatingStart!: string;
  @Field() operatingEnd!: string;
  @Field(() => Int) sessionDurationMinutes!: number;
  @Field(() => Int) breakDurationMinutes!: number;
  @Field({ nullable: true }) lunchStart?: string;
  @Field({ nullable: true }) lunchEnd?: string;
}
