-- Only the nine provinces are accepted (blank allowed for branches created before the province field existed)
alter table public.branches add constraint branches_province_valid check (
  province is null or province in ('Gauteng','Western Cape','KwaZulu-Natal','Eastern Cape','Free State','Limpopo','Mpumalanga','North West','Northern Cape')
);
