import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSessionsAndParticipants1792403592652 implements MigrationInterface {
  name = 'CreateSessionsAndParticipants1792403592652';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`sessions\` (\`id\` char(36) NOT NULL, \`title\` varchar(100) NOT NULL, \`status\` enum ('JOIN', 'LEAVE', 'END') NOT NULL DEFAULT 'JOIN', \`created_by\` varchar(64) NOT NULL, \`last_seq\` bigint UNSIGNED NOT NULL DEFAULT '0', \`participant_count\` tinyint UNSIGNED NOT NULL DEFAULT '0', \`created_at\` datetime(3) NOT NULL, \`ended_at\` datetime(3) NULL, \`updated_at\` datetime(3) NOT NULL, INDEX \`idx_sessions_status_created\` (\`status\`, \`created_at\`, \`id\`), INDEX \`idx_sessions_created\` (\`created_at\`, \`id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`participants\` (\`session_id\` char(36) NOT NULL, \`user_id\` varchar(64) NOT NULL, \`joined_at\` datetime(3) NOT NULL, \`left_at\` datetime(3) NULL, \`presence\` enum ('ONLINE', 'OFFLINE') NOT NULL DEFAULT 'OFFLINE', \`presence_at\` datetime(3) NULL, INDEX \`idx_participants_user\` (\`user_id\`, \`session_id\`), PRIMARY KEY (\`session_id\`, \`user_id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`participants\` ADD CONSTRAINT \`fk_participants_session\` FOREIGN KEY (\`session_id\`) REFERENCES \`sessions\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`participants\` DROP FOREIGN KEY \`fk_participants_session\``,
    );
    await queryRunner.query(
      `DROP INDEX \`idx_participants_user\` ON \`participants\``,
    );
    await queryRunner.query(`DROP TABLE \`participants\``);
    await queryRunner.query(
      `DROP INDEX \`idx_sessions_created\` ON \`sessions\``,
    );
    await queryRunner.query(
      `DROP INDEX \`idx_sessions_status_created\` ON \`sessions\``,
    );
    await queryRunner.query(`DROP TABLE \`sessions\``);
  }
}
