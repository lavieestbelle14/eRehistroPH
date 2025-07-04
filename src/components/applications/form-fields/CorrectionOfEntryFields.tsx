'use client';
import { Control } from 'react-hook-form';
import { z } from 'zod';
import { applicationFormSchema } from '@/schemas/applicationSchema';
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

type ApplicationFormValues = z.infer<typeof applicationFormSchema>;

interface CorrectionOfEntryFieldsProps {
  control: Control<ApplicationFormValues>;
}

export function CorrectionOfEntryFields({ control }: CorrectionOfEntryFieldsProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground mb-4">
            (Attach required supporting documents such as Certified Copy or Certificate of Court Order or Certificate of Live Birth, and others)
          </p>
          
          <div className="space-y-4">
            <FormField
              control={control}
              name="targetField"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Field to Correct</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a field to correct" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Name">Name</SelectItem>
                      <SelectItem value="Contact Number">Contact Number</SelectItem>
                      <SelectItem value="Email Address">Email Address</SelectItem>
                      <SelectItem value="Spouse name">Spouse name</SelectItem>
                      <SelectItem value="Date of Birth">Date of Birth</SelectItem>
                      <SelectItem value="Place of Birth">Place of Birth</SelectItem>
                      <SelectItem value="Father's Name">Father's Name</SelectItem>
                      <SelectItem value="Mother's Maiden Name">Mother's Maiden Name</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField 
              control={control}
              name="currentValue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Present Data/Information:</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField 
              control={control}
              name="requestedValue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New/Corrected Data/Information:</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
