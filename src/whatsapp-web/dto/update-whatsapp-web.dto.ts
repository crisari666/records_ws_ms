import { PartialType } from '@nestjs/mapped-types';
import { CreateWhatsappWebDto } from './create-whatsapp-web.dto';

export class UpdateWhatsappWebDto extends PartialType(CreateWhatsappWebDto) {}

