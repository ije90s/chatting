import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSnapshots1792405111519 implements MigrationInterface {
  name = 'CreateSnapshots1792405111519';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // chk_snapshots_state는 TypeORM이 MariaDB에서 생성하지 않아 직접 추가했다.
    await queryRunner.query(
      `CREATE TABLE \`snapshots\` (\`session_id\` char(36) NOT NULL, \`seq\` bigint UNSIGNED NOT NULL, \`state\` json NOT NULL, \`created_at\` datetime(3) NOT NULL, PRIMARY KEY (\`session_id\`, \`seq\`), CONSTRAINT \`chk_snapshots_state\` CHECK (JSON_VALID(\`state\`))) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`snapshots\` ADD CONSTRAINT \`fk_snapshots_session\` FOREIGN KEY (\`session_id\`) REFERENCES \`sessions\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`snapshots\` DROP FOREIGN KEY \`fk_snapshots_session\``,
    );
    await queryRunner.query(`DROP TABLE \`snapshots\``);
  }
}
