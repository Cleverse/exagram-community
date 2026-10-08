BEGIN;

ALTER TABLE "exagram"."artifacts"
	DROP CONSTRAINT "artifacts_kind_check";

ALTER TABLE "exagram"."artifacts"
	ADD CONSTRAINT "artifacts_kind_check"
	CHECK ("kind" IN ('doc','html','chat','pdf','docx','pptx','xlsx'));

COMMIT;
