import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMessages1792403948049 implements MigrationInterface {
  name = 'CreateMessages1792403948049';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // chk_messages_payload는 TypeORM이 MariaDB에서 생성하지 않아 직접 추가했다.
    await queryRunner.query(
      `CREATE TABLE \`messages\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`session_id\` char(36) NOT NULL, \`seq\` bigint UNSIGNED NOT NULL, \`type\` varchar(32) NOT NULL, \`actor_id\` varchar(64) NOT NULL, \`client_event_id\` char(36) NULL, \`payload\` json NOT NULL DEFAULT '{}', \`client_sent_at\` datetime(3) NULL, \`received_at\` datetime(3) NOT NULL, INDEX \`idx_messages_session_received\` (\`session_id\`, \`received_at\`), UNIQUE INDEX \`uk_messages_session_client_event\` (\`session_id\`, \`client_event_id\`), UNIQUE INDEX \`uk_messages_session_seq\` (\`session_id\`, \`seq\`), PRIMARY KEY (\`id\`), CONSTRAINT \`chk_messages_payload\` CHECK (JSON_VALID(\`payload\`))) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`sessions\` ADD \`message_count\` int UNSIGNED NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`sessions\` ADD \`last_message_seq\` bigint UNSIGNED NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`messages\` ADD CONSTRAINT \`fk_messages_session\` FOREIGN KEY (\`session_id\`) REFERENCES \`sessions\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`messages\` DROP FOREIGN KEY \`fk_messages_session\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`sessions\` DROP COLUMN \`last_message_seq\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`sessions\` DROP COLUMN \`message_count\``,
    );
    await queryRunner.query(
      `DROP INDEX \`uk_messages_session_seq\` ON \`messages\``,
    );
    await queryRunner.query(
      `DROP INDEX \`uk_messages_session_client_event\` ON \`messages\``,
    );
    await queryRunner.query(
      `DROP INDEX \`idx_messages_session_received\` ON \`messages\``,
    );
    await queryRunner.query(`DROP TABLE \`messages\``);
  }
}
